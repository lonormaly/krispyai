// @krispy/edge — the whole live-chat-with-human-handoff backend in one Worker.
//
// One Worker (not Pages Functions + a separate companion Worker) because there's
// no static site to host here and a DO must live in a Worker anyway — a single
// deploy, a single wrangler.toml, and it runs end-to-end under `wrangler dev`.
//
//   POST /api/chat                     visitor msg → AI + mirror to Telegram topic
//   POST /api/contact                  [!HANDOFF] contact-capture → owner's topic
//   POST /api/telegram/webhook         owner replies in a topic → push to visitor
//   POST /api/operator/reply           operator app reply → visitor (same DO spine)
//   POST /api/operator/handoffs        operator app inbox (handed-off sessions)
//   POST /api/operator/thread          one session's ring-buffer messages
//   POST /api/operator/resolve         toggle a session's resolved flag (inbox hygiene;
//                                      resolving also hands the session back to the AI)
//   GET  /api/session/:id/ws           live channel (→ SessionDO; ?role=operator tags)
//   GET  /api/usage?t=<tenant>         metering readout (plan/usage hooks)
//   GET  /health
import type { ChatMessage } from "./ai";
import { workersAiRunner, DEFAULT_MODEL } from "./ai";
import { chatFlow } from "./chat";
import { SessionDO, type RingMsg } from "./session-do";
import { buildSystemPrompt } from "./system-prompt";
import { parseOwnerReply, createForumTopic, sendToTopic, sendHandoffAlert } from "./telegram";
import { authorizeOperator } from "./operator-auth";
import { pushToApp } from "./push";
import { renderLeadEmail, sendLeadEmail } from "./email";
import type { Connector, Env, FormSpec, TenantConfig } from "./types";
import {
  getTenant,
  getThreadForSession,
  getSessionForThread,
  linkThreadSession,
  meter,
  meterUsage,
  getUsage,
  getTokens,
  getUsageDetail,
  getOperators,
  upsertOperator,
  entitled,
  withinPlan,
  writeEntitlement,
  readTenantConfig,
  mergeTenantConfig,
  publicWidgetConfig,
  DO_INTERNAL_HEADER,
  doInternalSecret,
  checkLeadRate,
  type EntitlementSnapshot,
} from "./store";

export { SessionDO };

const DEFAULT_TENANT = "self";

// ── DO-ring memory (chat context) ────────────────────────────────────────────
// The SessionDO's 20-msg ring is the bot's authoritative memory: the client's
// history array is spoofable, capped at 10 by the widget, and lost across devices.

/** Hard ceiling on the ring read — a slow/erroring DO must never make chat slower
 * than the old client-history path. On timeout/failure we warn + fall back. */
export const RING_READ_TIMEOUT_MS = 1_500;

/** Cap on ring-derived history — mirrors the widget's own `history.slice(-10)`, so
 * prompt size and the turn-tax guard keep exactly the pre-ring posture. */
export const RING_HISTORY_MAX = 10;

/** Ring → AI context. `visitor` → user; `ai` AND `operator` → assistant (the visitor
 * heard operator turns as "the business speaking", and the bot must know what the
 * human said after a hand-back). */
export function ringToHistory(
  msgs: { role: "visitor" | "ai" | "operator"; text: string }[],
  cap = RING_HISTORY_MAX,
): ChatMessage[] {
  return msgs
    .filter((m) => m.text)
    .map((m) => ({
      role: m.role === "visitor" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }))
    .slice(-cap);
}

// ── visitor-text length caps (cost-DoS + prompt-stuffing guard at the entry) ──
// Every place visitor text enters the model path is bounded here, BEFORE it reaches the
// AI: the live message and the client-sent history seed (both spoofable). The DO ring is
// covered transitively — the Worker only ever mirrors the already-clamped `message`.

/** Truncate any single visitor-supplied text to this many chars before the model sees
 * it. Friendly: a legit long paste is trimmed, not rejected. */
export const MAX_MESSAGE_CHARS = 4000;
/** Absurd-payload hard reject (413) — kills cost-DoS from a megabyte message; a real
 * support message is never this long. ponytail: char length is a fine proxy for the
 * ~32KB ceiling (multibyte only shrinks the char budget, still absurd). */
export const MAX_MESSAGE_HARD = 32 * 1024;

const clampText = (s: string): string =>
  s.length > MAX_MESSAGE_CHARS ? s.slice(0, MAX_MESSAGE_CHARS) : s;

/** Clamp each client-history item's content and bound the array length. The sliding
 * window + turn-tax already cap what reaches the model, but the handoff ring-seed
 * replays the WHOLE array (index.ts), so it's capped here too. */
export function sanitizeHistory(h?: ChatMessage[]): ChatMessage[] | undefined {
  if (!Array.isArray(h)) return undefined;
  return h
    .slice(-RING_HISTORY_MAX)
    .map((m) => ({ role: m.role, content: clampText(String(m.content ?? "")) }));
}

/** Parse a positive-integer env knob; undefined (→ code default) when unset/invalid. */
const numEnv = (v?: string): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function cors(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

const json = (env: Env, data: unknown, status = 200) =>
  Response.json(data, { status, headers: cors(env) });

function sessionStub(env: Env, tenantId: string, sessionId: string) {
  return env.SESSION.get(env.SESSION.idFromName(`${tenantId}:${sessionId}`));
}

/** Internal Worker→DO fetch: attaches the shared secret the DO verifies (the DO's
 * /state,/operator,/handoff are Worker-only). WS upgrades don't route through here. */
function doFetch(
  env: Env,
  tenantId: string,
  sessionId: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = {
    ...(init.headers as Record<string, string>),
    [DO_INTERNAL_HEADER]: doInternalSecret(env),
  };
  return sessionStub(env, tenantId, sessionId).fetch(path, { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors(env) });
    if (path === "/health") return json(env, { status: "ok", service: "edge" });

    if (request.method === "POST" && path === "/api/chat") return handleChat(request, env);
    if (request.method === "POST" && path === "/api/contact") return handleContact(request, env);
    if (request.method === "POST" && path === "/api/lead") return handleLead(request, env);
    if (request.method === "POST" && path === "/api/telegram/webhook")
      return handleWebhook(request, env);
    if (request.method === "POST" && path === "/api/operator/reply")
      return handleOperatorReply(request, env);
    if (request.method === "POST" && path === "/api/operator/handoffs")
      return handleOperatorHandoffs(request, env);
    if (request.method === "POST" && path === "/api/operator/thread")
      return handleOperatorThread(request, env);
    if (request.method === "POST" && path === "/api/operator/resolve")
      return handleOperatorResolve(request, env);
    if (request.method === "POST" && path === "/api/billing/entitlement")
      return handleEntitlementSync(request, env);
    if (request.method === "GET" && path === "/api/tenant/config")
      return handleTenantConfigGet(request, env);
    if (request.method === "POST" && path === "/api/tenant/config")
      return handleTenantConfigSet(request, env);
    if (request.method === "GET" && path === "/api/widget/config")
      return handleWidgetConfig(request, env);
    if (request.method === "GET" && path === "/api/usage") return handleUsage(request, env);
    if (request.method === "GET" && path === "/internal/usage")
      return handleAdminUsage(request, env);

    // GET /api/session/:sessionId/ws  → forward the upgrade to the session's DO.
    // The full request (query string included) is forwarded, so ?role=operator
    // rides through to the DO's socket tagging (§3d) with no extra plumbing here.
    // Operator sockets must authenticate: browsers/RN can't set headers on a WS
    // upgrade, so the bearer rides as ?auth=<token> and is verified against the
    // claimed tenant BEFORE the upgrade reaches the DO. The visitor path (no
    // role param) stays open — visitors are anonymous by design; their session
    // id is the capability they hold.
    const ws = path.match(/^\/api\/session\/([^/]+)\/ws$/);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const tenantId = url.searchParams.get("t") || DEFAULT_TENANT;
      if (url.searchParams.get("role") === "operator") {
        const denied = await authorizeOperator(
          request,
          env,
          tenantId,
          url.searchParams.get("auth"),
        );
        if (denied) return json(env, { error: denied.error }, denied.status);
      }
      return sessionStub(env, tenantId, decodeURIComponent(ws[1]!)).fetch(request);
    }

    return new Response("not found", { status: 404, headers: cors(env) });
  },
};

// ── POST /api/chat ───────────────────────────────────────────────────────────
async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    message?: string;
    tenantId?: string;
    history?: ChatMessage[];
  } | null;
  if (!body?.sessionId || !body.message?.trim()) {
    return json(env, { error: "sessionId and message required" }, 400);
  }
  // Absurd-payload fast-reject (cost-DoS) BEFORE any work. Legit-but-long messages fall
  // through to the friendly truncation below (clampText); only megabyte payloads 413.
  if (body.message.length > MAX_MESSAGE_HARD) {
    return json(env, { error: "message_too_large" }, 413);
  }
  // The single clamped copy of the visitor's text — used for the model input, the
  // Telegram mirror, the ring, and the push (DRY: trim+truncate once, here).
  const message = clampText(body.message.trim());
  const clientHistory = sanitizeHistory(body.history);
  const tenantId = body.tenantId || DEFAULT_TENANT;

  // Entitlement gate — before serving any Cloud feature. Self-host is always
  // entitled + unmetered; a Cloud tenant must have a valid (trial/active) sub and
  // be under its monthly cap. Push-driven: the snapshot was synced by billing.
  const ent = await entitled(env, tenantId);
  if (!ent.entitled) {
    return json(env, { error: "subscription_required", plan: ent.plan, status: ent.status }, 402);
  }
  if (!withinPlan(await getUsage(env, tenantId), ent.plan_limits)) {
    return json(env, { error: "usage_limit_reached", plan: ent.plan }, 429);
  }

  const tenant = await getTenant(env, tenantId);

  // Authoritative memory: one combined DO read (handoff flag + ring) replaces the
  // /state read the flow made anyway — same subrequest count, and the AI context
  // now comes from the server-side ring instead of the client's claim. GUARDED:
  // timeout + any failure falls back to the client-sent history exactly as before
  // (warn-logged so drift is observable); a slow DO never slows chat down.
  let ctx: { handedOff: boolean; messages: RingMsg[] } | null = null;
  try {
    const r = await doFetch(env, tenantId, body.sessionId, "https://do/context", {
      signal: AbortSignal.timeout(RING_READ_TIMEOUT_MS),
    });
    ctx = (await r.json()) as { handedOff: boolean; messages: RingMsg[] };
  } catch (e) {
    console.warn("ring context read failed — falling back to client history:", e);
  }
  // Client history is a SEED only: used when the ring is empty (first message of a
  // legacy session) or when the ring read failed (fallback path above).
  const history = ctx?.messages.length ? ringToHistory(ctx.messages) : clientHistory;

  // Telegram is optional: no config → topic ops no-op, chat still answers.
  const result = await chatFlow(
    {
      systemPrompt: buildSystemPrompt(tenant?.systemPrompt, tenant?.forms, tenant?.persona),
      // Ring-derived (or seed) history in; chatFlow applies the sliding window +
      // counts turns (chokepoint).
      history,
      maxHistoryMsgs: numEnv(env.MAX_HISTORY_MSGS),
      maxAiTurns: numEnv(env.MAX_AI_TURNS),
      ai: workersAiRunner(env, tenant?.model || env.AI_MODEL),
      meter: (kind) => meter(env, tenantId, kind),
      // Real per-turn usage → monthly counters (total + in/out split) AND a structured
      // log line (model + counts + estimated flag) for cost analytics via Logpush/tail.
      meterTokens: async (usage) => {
        await meterUsage(env, tenantId, usage);
        console.log(
          "chat_usage",
          JSON.stringify({
            tenant: tenantId,
            model: tenant?.model || env.AI_MODEL || DEFAULT_MODEL,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            estimated: usage.estimated,
          }),
        );
      },
      isHandedOff: ctx
        ? async () => ctx.handedOff // already read in the combined /context fetch
        : async (sessionId) => {
            const r = await doFetch(env, tenantId, sessionId, "https://do/state");
            return ((await r.json()) as { handedOff: boolean }).handedOff;
          },
      ensureTopic: async (sessionId, firstMessage) => {
        if (!tenant) return 0;
        const existing = await getThreadForSession(env, tenantId, sessionId);
        if (existing) return existing;
        const name = `${firstMessage.slice(0, 40)} · ${sessionId.slice(0, 6)}`;
        const threadId = await createForumTopic(tenant.botToken, tenant.chatId, name);
        await linkThreadSession(env, tenantId, threadId, sessionId);
        return threadId;
      },
      toTopic: async (threadId, text) => {
        if (tenant && threadId) await sendToTopic(tenant.botToken, tenant.chatId, threadId, text);
      },
    },
    { sessionId: body.sessionId, message },
  );

  // Mirror the turn into the session's ring buffer (operator-app inbox preview +
  // thread read) — best-effort, same posture as the Telegram mirror. On handoff,
  // seed the ring from the widget's re-sent history FIRST (the DO no-ops the seed
  // unless the ring is still empty), so pre-ring turns aren't lost.
  {
    const seed = result.handoff
      ? (clientHistory ?? [])
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
          .map((m) => ({ role: m.role === "user" ? "visitor" : "ai", text: m.content }))
      : [];
    const turn: { role: "visitor" | "ai"; text: string }[] = [{ role: "visitor", text: message }];
    if (result.reply) turn.push({ role: "ai", text: result.reply });
    if (seed.length) {
      await doFetch(env, tenantId, body.sessionId, "https://do/log", {
        method: "POST",
        body: JSON.stringify({ messages: seed, seed: true }),
      }).catch((e) => console.error("ring seed failed (best-effort):", e));
    }
    await doFetch(env, tenantId, body.sessionId, "https://do/log", {
      method: "POST",
      body: JSON.stringify({ messages: turn }),
    }).catch((e) => console.error("ring mirror failed (best-effort):", e));
  }

  // If the AI escalated, nudge the visitor's browser to open contact capture AND fire
  // the ONE loud handoff alert into the topic — @mentioning the tenant's operators so a
  // human's phone buzzes (routine mirrors above are all silent). No operators known yet →
  // the alert still posts, just without a mention (fallback path).
  if (result.handoff) {
    // The DO's /handoff is idempotent per escalation: `announced` is true only the FIRST
    // time, so a jailbroken bot re-emitting [!HANDOFF] every turn can't spam the loud
    // operator alert + push. Fail-open (default announced) if the DO read fails — a real
    // handoff must never be silently dropped. handBack resets the flag for a later one.
    const hr = await doFetch(env, tenantId, body.sessionId, "https://do/handoff", {
      method: "POST",
    });
    const { announced = true } = (await hr.json().catch(() => ({ announced: true }))) as {
      announced?: boolean;
    };
    if (announced) {
      // Wake the Buttr operator app — the push channel parallel to the Telegram alert.
      // Deliberately OUTSIDE the tenant/Telegram guard (an app-only tenant has no
      // Telegram config) and failure-tolerant by contract (push.ts never throws).
      await pushToApp(env, tenantId, body.sessionId, message);
      if (tenant) {
        const threadId = await getThreadForSession(env, tenantId, body.sessionId);
        if (threadId) {
          // 'app' operators get the push above — skip them here so they aren't
          // double-pinged (push + Telegram @mention). Absent channel = telegram.
          const operators = (await getOperators(env, tenantId)).filter((o) => o.channel !== "app");
          await sendHandoffAlert(
            tenant.botToken,
            tenant.chatId,
            threadId,
            "🙋 A visitor needs a human here.\nReply in this topic to answer them · send /done when finished to hand back to the AI.",
            operators,
          ).catch((e) => console.error("telegram handoff alert failed (best-effort):", e));
        }
      }
    }
  }

  // Resolve the FormSpec (+ its visitor-facing CTA connectors) so the widget — which
  // holds no tenant config — can render the form and its wa.me/instagram links.
  if (result.formId) {
    const spec = tenant?.forms?.find((f) => f.id === result.formId) ?? null;
    if (spec) {
      // `ctas` rides on the wire form only (visitor-facing links); not part of FormSpec.
      result.form = { ...spec, ctas: ctaConnectors(tenant, spec) } as FormSpec & {
        ctas: Connector[];
      };
    } else {
      // Unknown id for this tenant — a jailbroken/hallucinated [!FORM:<id>]. DROP it
      // entirely (not just form:null) so the widget never raises an arbitrary/unexpected
      // form the tenant didn't configure.
      result.formId = null;
      result.form = null;
    }
  }
  return json(env, result);
}

/** The visitor-facing CTA connectors (whatsapp/instagram) for a form — email/telegram
 * are invisible delivery channels and never leave the server. */
function ctaConnectors(tenant: TenantConfig | null, form: FormSpec): Connector[] {
  const all = tenant?.connectors ?? [];
  const scoped = form.connectorIds ? all.filter((c) => form.connectorIds!.includes(c.id)) : all;
  return scoped.filter((c) => c.type === "whatsapp" || c.type === "instagram");
}

// ── POST /api/contact ──────────────────────────────────────────────────────
// Back-compat shim — embeds in the wild still POST the legacy {name, contact} shape.
// Maps it onto the generalized lead fan-out (deliverLead), so both routes share one path.
async function handleContact(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as {
    sessionId?: string;
    tenantId?: string;
    name?: string;
    contact?: string;
    message?: string;
  } | null;
  if (!b?.sessionId) return json(env, { error: "sessionId required" }, 400);
  const tenantId = b.tenantId || DEFAULT_TENANT;
  if (!(await checkLeadRate(env, tenantId, b.sessionId)))
    return json(env, { error: "rate_limited" }, 429);
  await deliverLead(env, {
    tenantId,
    sessionId: b.sessionId,
    formId: null,
    values: { name: b.name || "", contact: b.contact || "", message: b.message || "" },
    history: [],
  });
  return json(env, { ok: true });
}

// ── POST /api/lead ─────────────────────────────────────────────────────────
// The generalized lead endpoint: a data-driven form's captured values fan out to the
// tenant's DELIVERY connectors (Telegram + email). whatsapp/instagram are CTA-only —
// the visitor taps those links; nothing is delivered server-side for them.
interface LeadPayload {
  tenantId: string;
  sessionId: string;
  formId: string | null;
  values: Record<string, string>;
  history: { role: string; content: string }[];
}

async function handleLead(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as Partial<LeadPayload> | null;
  if (!b?.sessionId) return json(env, { error: "sessionId required" }, 400);
  const tenantId = b.tenantId || DEFAULT_TENANT;
  if (!(await checkLeadRate(env, tenantId, b.sessionId)))
    return json(env, { error: "rate_limited" }, 429);
  await deliverLead(env, {
    tenantId,
    sessionId: b.sessionId,
    formId: b.formId ?? null,
    values: b.values || {},
    history: Array.isArray(b.history) ? b.history : [],
  });
  return json(env, { ok: true });
}

/**
 * Resolve tenant + FormSpec + connectors, then fan a lead out to the delivery channels:
 *   • Telegram — the existing sendToTopic into the visitor's topic (already has the full mirror)
 *   • Email    — Resend, silent no-op without a key (email.ts)
 * whatsapp/instagram connectors are never delivered here (CTA-only in the widget).
 */
export async function deliverLead(env: Env, lead: LeadPayload): Promise<void> {
  const tenant = await getTenant(env, lead.tenantId);
  const form = tenant?.forms?.find((f) => f.id === lead.formId) ?? null;
  const connectors = tenant?.connectors ?? [];
  // Which connectors get this lead: the form's scoped set, else all configured.
  const targets = form?.connectorIds
    ? connectors.filter((c) => form.connectorIds!.includes(c.id))
    : connectors;

  // Telegram delivery — drop the values into the visitor's topic.
  if (tenant) {
    const threadId = await getThreadForSession(env, lead.tenantId, lead.sessionId);
    if (threadId) {
      const lines = Object.entries(lead.values)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `• ${k}: ${v}`)
        .join("\n");
      await sendToTopic(
        tenant.botToken,
        tenant.chatId,
        threadId,
        `📇 ${form?.title || "Lead"} captured:\n${lines || "—"}`,
      );
    }
  }

  // Email delivery — every email connector in scope. wa.me reply button when a
  // whatsapp connector exists. Silent no-op without RESEND_API_KEY (self-host may
  // rely on Telegram only).
  const waPhone = targets.find((c) => c.type === "whatsapp")?.phone;
  const emailTargets = targets.filter((c) => c.type === "email" && c.toAddress);
  for (const c of emailTargets) {
    const mail = renderLeadEmail(form, lead.values, lead.history, waPhone);
    await sendLeadEmail(env.RESEND_API_KEY, env.LEAD_EMAIL_FROM, c.toAddress, mail);
  }
}

// ── POST /api/telegram/webhook ─────────────────────────────────────────────
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // Verify the shared secret Telegram echoes back (set at setWebhook time).
  if (
    env.TELEGRAM_WEBHOOK_SECRET &&
    request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await request.json().catch(() => null);
  const reply = update ? parseOwnerReply(update) : null;
  if (!reply) return new Response("ok"); // not an owner reply — ack and ignore

  // Which tenant? Self-host: "self". Multi-tenant would resolve by chat id here.
  const tenantId = DEFAULT_TENANT;
  const sessionId = await getSessionForThread(env, tenantId, reply.threadId);
  if (sessionId) {
    // Auto-learn: whoever replies in a managed topic becomes a taggable operator for the
    // next handoff (zero-config). Only in managed topics so random group chatter isn't learned.
    if (reply.from) {
      await upsertOperator(env, tenantId, {
        id: reply.from.id,
        name: reply.from.name,
        username: reply.from.username,
      });
    }
    // "/done" (or "resolved") in the topic = the operator is finished → resolve the
    // session AND hand it back to the AI (the DO clears handedOff + broadcasts
    // {type:"resume"}). Force-set (not toggle) so a repeat /done can't un-resolve.
    // The command is documented in the handoff alert (see sendHandoffAlert call).
    const cmd = reply.text.toLowerCase();
    if (cmd === "/done" || cmd === "resolved") {
      await doFetch(env, tenantId, sessionId, "https://do/resolve", {
        method: "POST",
        body: JSON.stringify({ resolved: true }),
      });
      const tenant = await getTenant(env, tenantId);
      if (tenant) {
        await sendToTopic(
          tenant.botToken,
          tenant.chatId,
          reply.threadId,
          "✅ Resolved — the AI has this chat again. Reply here anytime to take back over.",
        ).catch((e) => console.error("telegram resolve ack failed (best-effort):", e));
      }
      return new Response("ok");
    }
    await doFetch(env, tenantId, sessionId, "https://do/operator", {
      method: "POST",
      body: JSON.stringify({ text: reply.text }),
    });
    await meter(env, tenantId, "handoff");
  }
  return new Response("ok");
}

// ── operator app routes (Buttr) ──────────────────────────────────────────────
// The native operator app's surface onto the SAME SessionDO handoff spine Telegram
// uses — a second trigger, zero Telegram interference. Auth (operator-auth.ts):
// every route verifies the app's bearer against the cloud API's /me and asserts
// the resolved user IS the claimed tenant (401/403 otherwise); server-to-server
// callers may use the tenant-sync shared secret instead. Field validation runs
// first (400 on malformed bodies), auth second — nothing tenant-scoped happens
// before the auth gate.

// ponytail: single app-operator sentinel id per tenant (Operator.id is a Telegram
// numeric id; the app has none). Per-operator ids when the app grows multi-operator auth.
const APP_OPERATOR_ID = 0;

// POST /api/operator/reply { tenantId, sessionId, text, operatorName? }
// → visitor's widget receives { type: "operator", text } over its existing WS.
async function handleOperatorReply(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as {
    tenantId?: string;
    sessionId?: string;
    text?: string;
    operatorName?: string;
  } | null;
  if (!b?.tenantId || !b.sessionId || !b.text?.trim()) {
    return json(env, { error: "tenantId, sessionId and text required" }, 400);
  }
  const denied = await authorizeOperator(request, env, b.tenantId);
  if (denied) return json(env, { error: denied.error }, denied.status);
  // Learn the app operator (channel:'app' → the Telegram @mention path skips them).
  await upsertOperator(env, b.tenantId, {
    id: APP_OPERATOR_ID,
    name: b.operatorName,
    channel: "app",
  });
  await doFetch(env, b.tenantId, b.sessionId, "https://do/operator", {
    method: "POST",
    body: JSON.stringify({ text: b.text.trim() }),
  });
  await meter(env, b.tenantId, "handoff");
  return json(env, { ok: true, delivered: true });
}

// POST /api/operator/handoffs { tenantId, includeResolved? } → the operator app's
// inbox. Resolved sessions are EXCLUDED by default (inbox hygiene); pass
// { includeResolved: true } to list them too (each row carries `resolved`).
// No dedicated handoff index exists — the session→thread KV map doubles as the
// session index; each session's DO answers one /summary (handoff flag + ring tail).
// ponytail: first KV page only (1000 sessions) + one DO subrequest per session —
// fine for an operator inbox; add a real handoff index if a tenant outgrows it.
async function handleOperatorHandoffs(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as {
    tenantId?: string;
    includeResolved?: boolean;
  } | null;
  if (!b?.tenantId) return json(env, { error: "tenantId required" }, 400);
  const denied = await authorizeOperator(request, env, b.tenantId);
  if (denied) return json(env, { error: denied.error }, denied.status);
  const tenantId = b.tenantId;
  const includeResolved = b.includeResolved === true;
  const prefix = `session:${tenantId}:`;
  const list = await env.KRISPY_KV.list({ prefix });
  const rows = await Promise.all(
    list.keys.map(async ({ name }) => {
      const sessionId = name.slice(prefix.length);
      const r = await doFetch(env, tenantId, sessionId, "https://do/summary");
      const s = (await r.json()) as {
        handedOff: boolean;
        resolved?: boolean;
        lastMessage: string | null;
        ts: number | null;
      };
      const resolved = s.resolved === true;
      // Default inbox = handed-off & unresolved. Resolving hands the session back to
      // the AI (handedOff flips false), so resolved rows are listed by their resolved
      // flag instead — includeResolved keeps the app's history/undo-swipe view alive.
      const listed = resolved ? includeResolved : s.handedOff;
      return listed
        ? { sessionId, lastMessage: s.lastMessage, handedOff: s.handedOff, ts: s.ts, resolved }
        : null;
    }),
  );
  const conversations = rows
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // eslint-disable-next-line unicorn/no-array-sort -- rows is local; in-place sort is fine (toSorted needs a newer TS lib)
    .sort((a, z) => (z.ts ?? 0) - (a.ts ?? 0)); // newest activity first
  return json(env, { conversations });
}

// POST /api/operator/thread { tenantId, sessionId } → the session's ring buffer.
async function handleOperatorThread(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as {
    tenantId?: string;
    sessionId?: string;
  } | null;
  if (!b?.tenantId || !b.sessionId) {
    return json(env, { error: "tenantId and sessionId required" }, 400);
  }
  const denied = await authorizeOperator(request, env, b.tenantId);
  if (denied) return json(env, { error: denied.error }, denied.status);
  const r = await doFetch(env, b.tenantId, b.sessionId, "https://do/log");
  const { messages } = (await r.json()) as { messages: unknown[] };
  return json(env, { messages });
}

// POST /api/operator/resolve { tenantId, sessionId } → toggle the session's
// resolved flag in its DO. Resolving ALSO hands the session back to the AI
// (handedOff=false + {type:"resume"} — the DO owns that). Resolved sessions drop
// out of the default inbox; a new live visitor message un-resolves them WITHOUT
// re-handing-off (the DO handles both on ring-append).
async function handleOperatorResolve(request: Request, env: Env): Promise<Response> {
  const b = (await request.json().catch(() => null)) as {
    tenantId?: string;
    sessionId?: string;
  } | null;
  if (!b?.tenantId || !b.sessionId) {
    return json(env, { error: "tenantId and sessionId required" }, 400);
  }
  const denied = await authorizeOperator(request, env, b.tenantId);
  if (denied) return json(env, { error: denied.error }, denied.status);
  const r = await doFetch(env, b.tenantId, b.sessionId, "https://do/resolve", { method: "POST" });
  const { resolved } = (await r.json()) as { resolved: boolean };
  return json(env, { ok: true, resolved });
}

// ── POST /api/billing/entitlement ──────────────────────────────────────────
// Optional push endpoint for a hosted/multi-tenant deployment: a billing service
// (payment webhook / trial start) mirrors a tenant's entitlement snapshot into KV so
// the gate can read it. Unused in single-tenant self-host. Guarded by a shared secret
// — never exposed to the widget/browser.
async function handleEntitlementSync(request: Request, env: Env): Promise<Response> {
  if (
    !env.BILLING_SYNC_SECRET ||
    request.headers.get("x-billing-sync-secret") !== env.BILLING_SYNC_SECRET
  ) {
    return new Response("forbidden", { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    tenantId?: string;
    snapshot?: EntitlementSnapshot;
  } | null;
  if (!body?.tenantId || !body.snapshot) {
    return json(env, { error: "tenantId and snapshot required" }, 400);
  }
  await writeEntitlement(env, body.tenantId, body.snapshot);
  return json(env, { ok: true });
}

// ── /api/tenant/config ─────────────────────────────────────────────────────
// The `krispy` CLI (packages/cli) — or Krispy Cloud, or your own tooling — reads/writes
// a tenant's Telegram creds + prompt/model here so getTenant() drives the bot. Guarded
// by a shared secret (x-tenant-sync-secret == TENANT_SYNC_SECRET) — the config holds a
// bot token, so NEVER expose it without the secret. 401 (not 403): auth required, none accepted.
function tenantSyncAuthed(request: Request, env: Env): boolean {
  return (
    !!env.TENANT_SYNC_SECRET &&
    request.headers.get("x-tenant-sync-secret") === env.TENANT_SYNC_SECRET
  );
}

// GET /api/tenant/config?t=<tenantId> → { botToken, chatId, systemPrompt?, model? } | 404
async function handleTenantConfigGet(request: Request, env: Env): Promise<Response> {
  if (!tenantSyncAuthed(request, env))
    return new Response("unauthorized", { status: 401, headers: cors(env) });
  const tenantId = new URL(request.url).searchParams.get("t");
  if (!tenantId) return json(env, { error: "t required" }, 400);
  const cfg = await readTenantConfig(env, tenantId);
  if (!cfg) return json(env, { error: "not found" }, 404);
  return json(env, cfg);
}

// ── config write caps (trust boundary) ─────────────────────────────────────
// Hard rejects on the write path — the widget/chat read paths trust what's in KV,
// so anything the projection will serve to the public web gets bounded HERE. Size
// caps → 413; malformed values (scheme/protocol) → 400. kbSources is validated
// ahead of its schema landing (cap precedes the field — later phases ship into an
// already-guarded door).
export const AVATAR_MAX_CHARS = 48 * 1024; // data-URI logos; ~10–30KB typical
export const KB_SOURCES_MAX_CHARS = 100_000; // total text across all sources
export const THEME_TEXT_MAX_CHARS = 500; // free-text theme strings projected to the public widget
export const POPUPS_MAX = 8; // popup entries per tenant
export const SELECTOR_MAX_CHARS = 200; // CSS selector strings (near-trigger + cancelOnClick)
export const OPENING_MAX = 5; // scripted opening bubbles (mirrors the projection cap)
export const STARTERS_MAX = 4; // starter chips (mirrors the projection cap)
export const PERSONA_SCRIPT_MAX_CHARS = 8 * 1024; // combined persona + script free text
const AVATAR_SCHEME = /^(https:\/\/|data:image\/(png|webp|jpeg);base64,)/;

function tenantConfigCapError(
  cfg: Partial<TenantConfig>,
): { error: string; status: number } | null {
  const avatar = cfg.theme?.avatar;
  if (avatar !== undefined) {
    if (avatar.length > AVATAR_MAX_CHARS) return { error: "avatar_too_large", status: 413 };
    if (avatar !== "buttr" && !AVATAR_SCHEME.test(avatar))
      return { error: "avatar_scheme_invalid", status: 400 };
  }
  // Free-text theme strings render verbatim in the public widget — bound them so a
  // config write can't push an unbounded string into every visitor's boot response.
  for (const s of [cfg.theme?.tagline, cfg.theme?.popupText]) {
    if (s !== undefined && s.length > THEME_TEXT_MAX_CHARS)
      return { error: "theme_text_too_large", status: 413 };
  }
  // CTA urls must be https — they render as visitor-facing links in the widget.
  // `url` (facebook/tiktok/link connectors, later phase) checked alongside profileUrl.
  for (const c of cfg.connectors ?? []) {
    for (const u of [c.profileUrl, (c as { url?: string }).url]) {
      if (u !== undefined && !u.startsWith("https://"))
        return { error: "cta_url_not_https", status: 400 };
    }
    // phone feeds server-built `tel:+<phone>` / `wa.me/<phone>` hrefs — digits only
    // (after stripping the usual + - space () separators). A junk phone would only
    // yield a dead link, but reject it at the boundary rather than serve a broken CTA.
    const phone = (c as { phone?: string }).phone;
    if (phone !== undefined && !/^[0-9]+$/.test(phone.replace(/[\s+()-]/g, "")))
      return { error: "cta_phone_invalid", status: 400 };
  }
  const kbSources = (cfg as { kbSources?: { text?: string }[] }).kbSources;
  if (kbSources) {
    const total = kbSources.reduce((n, s) => n + (s.text?.length ?? 0), 0);
    if (total > KB_SOURCES_MAX_CHARS) return { error: "kb_sources_too_large", status: 413 };
  }
  // Popups render teaser cards + observe CSS selectors on the visitor's page — all reach
  // the public boot config. Bound the count, the copy, and the selector strings.
  const popups = cfg.popups;
  if (popups) {
    if (popups.length > POPUPS_MAX) return { error: "too_many_popups", status: 413 };
    for (const p of popups) {
      if ((p.text?.length ?? 0) > THEME_TEXT_MAX_CHARS)
        return { error: "popup_text_too_large", status: 413 };
      const selectors = [
        p.trigger?.kind === "near" ? p.trigger.selector : undefined,
        p.cancelOnClick,
      ];
      for (const sel of selectors) {
        if (sel !== undefined && sel.length > SELECTOR_MAX_CHARS)
          return { error: "popup_selector_too_large", status: 413 };
      }
    }
  }
  // Conversation script (opening bubbles + starter chips) is bounded by entry count; the
  // widget renders at most 5/4 (projection slices to match). Persona (tone + style rules)
  // + script share one combined text cap — persona rides the system prompt, script the boot.
  const script = cfg.script;
  if (script) {
    if ((script.opening?.length ?? 0) > OPENING_MAX)
      return { error: "too_many_opening", status: 413 };
    if ((script.starters?.length ?? 0) > STARTERS_MAX)
      return { error: "too_many_starters", status: 413 };
  }
  const sumLen = (arr?: string[]) => (arr ?? []).reduce((n, s) => n + s.length, 0);
  const personaScriptChars =
    (cfg.persona?.toneOfVoice?.length ?? 0) +
    sumLen(cfg.persona?.styleRules) +
    sumLen(script?.opening) +
    sumLen(script?.starters);
  if (personaScriptChars > PERSONA_SCRIPT_MAX_CHARS)
    return { error: "persona_script_too_large", status: 413 };
  return null;
}

// POST /api/tenant/config { tenantId, config } → merge into KV, { ok: true }
async function handleTenantConfigSet(request: Request, env: Env): Promise<Response> {
  if (!tenantSyncAuthed(request, env))
    return new Response("unauthorized", { status: 401, headers: cors(env) });
  const body = (await request.json().catch(() => null)) as {
    tenantId?: string;
    config?: Partial<TenantConfig>;
  } | null;
  if (!body?.tenantId || !body.config) {
    return json(env, { error: "tenantId and config required" }, 400);
  }
  const bad = tenantConfigCapError(body.config);
  if (bad) return json(env, { error: bad.error }, bad.status);
  await mergeTenantConfig(env, body.tenantId, body.config);
  return json(env, { ok: true });
}

// ── GET /api/widget/config ───────────────────────────────────────────────────
// PUBLIC (CORS-*, no secret): the widget's boot-time read of its appearance/forms.
// Returns ONLY the whitelist projection (publicWidgetConfig) — NEVER botToken/chatId/
// systemPrompt. The widget must never reach the secret-guarded GET /api/tenant/config.
async function handleWidgetConfig(request: Request, env: Env): Promise<Response> {
  const t = new URL(request.url).searchParams.get("t") || DEFAULT_TENANT;
  const cfg = await readTenantConfig(env, t);
  // Short public cache — the boot config (now up to ~10–30KB with a data-URI avatar)
  // is otherwise refetched uncached on every page load. 60s keeps edits near-live.
  return Response.json(publicWidgetConfig(cfg), {
    headers: { ...cors(env), "Cache-Control": "public, max-age=60" },
  });
}

// ── GET /internal/usage ──────────────────────────────────────────────────────
// Secret-authed cross-tenant usage readout for the Krispy Cloud admin. workerd (the
// cloud app) can't read the edge's KV directly, so the founder's cost view fetches the
// per-tenant token counters (in/out split) over this one guarded call. Fail-closed:
// no ADMIN_USAGE_SECRET configured, or a mismatched header → 403 (the counters have no
// auth of their own — never leak them unauthenticated). `?t=` accepts one tenant id or a
// comma-separated batch, so the admin fetches N tenants in one round-trip.
//   GET /internal/usage?t=a,b  →  { usage: { a: {ai,handoff,tokens,tokensIn,tokensOut}, b: {…} } }
async function handleAdminUsage(request: Request, env: Env): Promise<Response> {
  if (
    !env.ADMIN_USAGE_SECRET ||
    request.headers.get("x-admin-usage-secret") !== env.ADMIN_USAGE_SECRET
  ) {
    return new Response("forbidden", { status: 403, headers: cors(env) });
  }
  const raw = new URL(request.url).searchParams.get("t");
  const tenantIds = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tenantIds.length === 0) return json(env, { error: "t required" }, 400);
  const entries = await Promise.all(
    tenantIds.map(async (t) => [t, await getUsageDetail(env, t)] as const),
  );
  return json(env, { usage: Object.fromEntries(entries) });
}

// ── GET /api/usage ─────────────────────────────────────────────────────────
// Metering readout wired to the plan: usage counters vs the entitlement's caps.
async function handleUsage(request: Request, env: Env): Promise<Response> {
  const tenantId = new URL(request.url).searchParams.get("t") || DEFAULT_TENANT;
  const [usage, tokens, ent] = await Promise.all([
    getUsage(env, tenantId),
    getTokens(env, tenantId),
    entitled(env, tenantId),
  ]);
  return json(env, {
    tenantId,
    usage: { ...usage, tokens },
    plan: ent.plan,
    entitled: ent.entitled,
    status: ent.status,
    limits: ent.plan_limits,
    withinLimits: withinPlan(usage, ent.plan_limits),
  });
}
