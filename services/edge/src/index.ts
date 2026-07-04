// @krispy/edge — the whole live-chat-with-human-handoff backend in one Worker.
//
// One Worker (not Pages Functions + a separate companion Worker) because there's
// no static site to host here and a DO must live in a Worker anyway — a single
// deploy, a single wrangler.toml, and it runs end-to-end under `wrangler dev`.
//
//   POST /api/chat                     visitor msg → AI + mirror to Telegram topic
//   POST /api/contact                  [!HANDOFF] contact-capture → owner's topic
//   POST /api/telegram/webhook         owner replies in a topic → push to visitor
//   GET  /api/session/:id/ws           visitor's live channel (→ SessionDO)
//   GET  /api/usage?t=<tenant>         metering readout (plan/usage hooks)
//   GET  /health
import type { ChatMessage } from "./ai";
import { workersAiRunner } from "./ai";
import { chatFlow } from "./chat";
import { SessionDO } from "./session-do";
import { buildSystemPrompt } from "./system-prompt";
import { parseOwnerReply, createForumTopic, sendToTopic } from "./telegram";
import { renderLeadEmail, sendLeadEmail } from "./email";
import type { Connector, Env, FormSpec, TenantConfig } from "./types";
import {
  getTenant,
  getThreadForSession,
  getSessionForThread,
  linkThreadSession,
  meter,
  getUsage,
  getTokens,
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

/** Parse a positive-integer env knob; undefined (→ code default) when unset/invalid. */
const numEnv = (v?: string): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function cors(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
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
    if (request.method === "POST" && path === "/api/billing/entitlement")
      return handleEntitlementSync(request, env);
    if (request.method === "GET" && path === "/api/tenant/config")
      return handleTenantConfigGet(request, env);
    if (request.method === "POST" && path === "/api/tenant/config")
      return handleTenantConfigSet(request, env);
    if (request.method === "GET" && path === "/api/widget/config")
      return handleWidgetConfig(request, env);
    if (request.method === "GET" && path === "/api/usage") return handleUsage(request, env);

    // GET /api/session/:sessionId/ws  → forward the upgrade to the session's DO.
    const ws = path.match(/^\/api\/session\/([^/]+)\/ws$/);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const tenantId = url.searchParams.get("t") || DEFAULT_TENANT;
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

  // Telegram is optional: no config → topic ops no-op, chat still answers.
  const result = await chatFlow(
    {
      systemPrompt: buildSystemPrompt(tenant?.systemPrompt, tenant?.forms),
      // Full history in; chatFlow applies the sliding window + counts turns (chokepoint).
      history: body.history,
      maxHistoryMsgs: numEnv(env.MAX_HISTORY_MSGS),
      maxAiTurns: numEnv(env.MAX_AI_TURNS),
      ai: workersAiRunner(env, tenant?.model || env.AI_MODEL),
      meter: (kind) => meter(env, tenantId, kind),
      meterTokens: (n) => meter(env, tenantId, "tokens", n),
      isHandedOff: async (sessionId) => {
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
    { sessionId: body.sessionId, message: body.message.trim() },
  );

  // If the AI escalated, nudge the visitor's browser to open contact capture.
  if (result.handoff)
    await doFetch(env, tenantId, body.sessionId, "https://do/handoff", { method: "POST" });

  // Resolve the FormSpec (+ its visitor-facing CTA connectors) so the widget — which
  // holds no tenant config — can render the form and its wa.me/instagram links.
  if (result.formId) {
    const spec = tenant?.forms?.find((f) => f.id === result.formId) ?? null;
    // `ctas` rides on the wire form only (visitor-facing links); not part of FormSpec.
    result.form = spec
      ? ({ ...spec, ctas: ctaConnectors(tenant, spec) } as FormSpec & { ctas: Connector[] })
      : null;
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
    await doFetch(env, tenantId, sessionId, "https://do/operator", {
      method: "POST",
      body: JSON.stringify({ text: reply.text }),
    });
    await meter(env, tenantId, "handoff");
  }
  return new Response("ok");
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
  return json(env, publicWidgetConfig(cfg));
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
