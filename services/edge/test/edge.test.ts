// Unit tests for everything local-testable WITHOUT Telegram / Workers AI / a
// public webhook (those are service-gated — see README). Run: `bun test`.
import { expect, test, describe } from "bun:test";
import worker from "../src/index";
import {
  buildSystemPrompt,
  parseHandoff,
  parseForm,
  HANDOFF_MARKER,
  BREVITY_INSTRUCTION,
} from "../src/system-prompt";
import { renderLeadEmail } from "../src/email";
import { deliverLead } from "../src/index";
import { parseOwnerReply } from "../src/telegram";
import { broadcast, SessionDO } from "../src/session-do";
import { workersAiRunner, MAX_OUTPUT_TOKENS, type ChatMessage } from "../src/ai";
import {
  chatFlow,
  FALLBACK_REPLY,
  MAX_AI_TURNS,
  MAX_HISTORY_MSGS,
  type ChatDeps,
} from "../src/chat";
import {
  kThreadToSession,
  kSessionToThread,
  kUsage,
  monthKey,
  meter,
  getUsage,
  getTokens,
  getThreadForSession,
  linkThreadSession,
  getTenant,
  withinPlan,
  planFor,
  entitled,
  writeEntitlement,
  readEntitlement,
  readTenantConfig,
  mergeTenantConfig,
  checkLeadRate,
  LEAD_RATE_MAX,
  DO_INTERNAL_HEADER,
  doInternalSecret,
  type EntitlementSnapshot,
} from "../src/store";
import type { Env } from "../src/types";

// ── a Map-backed fake of the bits of Env the store touches ───────────────────
function fakeEnv(extra: Partial<Env> = {}): Env {
  const kv = new Map<string, string>();
  return {
    KRISPY_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    },
    ...extra,
  } as unknown as Env;
}

// ── [!HANDOFF] contract ──────────────────────────────────────────────────────
describe("parseHandoff", () => {
  test("plain reply → no handoff, text untouched", () => {
    expect(parseHandoff("We open at 9am.")).toEqual({ text: "We open at 9am.", handoff: false });
  });
  test("marker → stripped from visitor text, handoff true", () => {
    const r = parseHandoff(`Let me get someone. ${HANDOFF_MARKER}`);
    expect(r.handoff).toBe(true);
    expect(r.text).toBe("Let me get someone.");
    expect(r.text).not.toContain("[!HANDOFF]");
  });
  test("buildSystemPrompt always restates the handoff contract", () => {
    expect(buildSystemPrompt()).toContain(HANDOFF_MARKER);
    expect(buildSystemPrompt("Custom brand voice.")).toContain(HANDOFF_MARKER);
  });
});

// ── Telegram webhook parsing ─────────────────────────────────────────────────
describe("parseOwnerReply", () => {
  test("owner thread reply → extracted", () => {
    expect(parseOwnerReply({ message: { text: "on my way", message_thread_id: 42 } })).toEqual({
      threadId: 42,
      text: "on my way",
    });
  });
  test("bot's own echo → ignored", () => {
    expect(
      parseOwnerReply({ message: { text: "hi", message_thread_id: 42, from: { is_bot: true } } }),
    ).toBeNull();
  });
  test("topic-created service message → ignored", () => {
    expect(
      parseOwnerReply({ message: { message_thread_id: 42, forum_topic_created: {} } }),
    ).toBeNull();
  });
  test("General topic (no thread id) → ignored", () => {
    expect(parseOwnerReply({ message: { text: "hi" } })).toBeNull();
  });
});

// ── topic<->session mapping + metering ───────────────────────────────────────
describe("store", () => {
  test("key builders are stable", () => {
    expect(kThreadToSession("self", 7)).toBe("thread:self:7");
    expect(kSessionToThread("self", "s1")).toBe("session:self:s1");
    expect(kUsage("self", "ai", "202607")).toBe("usage:self:202607:ai");
    expect(monthKey(new Date(Date.UTC(2026, 6, 3)))).toBe("202607");
  });
  test("link is two-way and round-trips", async () => {
    const env = fakeEnv();
    await linkThreadSession(env, "self", 99, "sess-abc");
    expect(await getThreadForSession(env, "self", "sess-abc")).toBe(99);
  });
  test("meter increments per kind, getUsage reads back", async () => {
    const env = fakeEnv();
    await meter(env, "self", "ai");
    await meter(env, "self", "ai");
    await meter(env, "self", "handoff");
    expect(await getUsage(env, "self")).toEqual({ ai: 2, handoff: 1 });
  });
  test("getTenant('self') needs both token and chat id", async () => {
    expect(await getTenant(fakeEnv(), "self")).toBeNull();
    const ok = await getTenant(
      fakeEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "-100" }),
      "self",
    );
    expect(ok?.botToken).toBe("t");
  });
  test("getTenant('self') merges KV forms/connectors/theme over env creds (P1)", async () => {
    const env = fakeEnv({ TELEGRAM_BOT_TOKEN: "envtok", TELEGRAM_CHAT_ID: "-100" });
    // KV blob for "self" holds forms/connectors/theme + a stale bot token
    await mergeTenantConfig(env, "self", {
      botToken: "kv-stale-token",
      forms: [{ id: "book", title: "Book a call", fields: [] }],
      connectors: [{ id: "e", type: "email", toAddress: "owner@x.co" }],
      theme: { greeting: "hi there" },
      systemPrompt: "kv prompt",
    });
    const t = await getTenant(env, "self");
    // env creds win for the secret…
    expect(t?.botToken).toBe("envtok");
    expect(t?.chatId).toBe("-100");
    // …but KV supplies the non-secret keys the chat/lead path needs
    expect(t?.forms?.[0]?.id).toBe("book");
    expect(t?.connectors?.[0]?.toAddress).toBe("owner@x.co");
    expect(t?.theme?.greeting).toBe("hi there");
    // env unset ⇒ KV systemPrompt survives (env override only when set)
    expect(t?.systemPrompt).toBe("kv prompt");
    const overridden = await getTenant({ ...env, SYSTEM_PROMPT: "env prompt" } as any, "self");
    expect(overridden?.systemPrompt).toBe("env prompt");
  });
  test("plan gate", () => {
    expect(withinPlan({ ai: 0, handoff: 0 }, planFor("self"))).toBe(true);
    expect(withinPlan({ ai: 5, handoff: 0 }, { aiPerMonth: 5, handoffPerMonth: 10 })).toBe(false);
  });
});

// ── entitlement gate (Krispy Cloud billing) ──────────────────────────────────
describe("entitlement", () => {
  const cloudSnap = (over: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    plan: "cloud",
    status: "trialing",
    entitled: true,
    limits: { aiPerMonth: 5000, handoffPerMonth: null },
    trialEndsAt: "2026-07-17T00:00:00Z",
    currentPeriodEnd: null,
    updatedAt: "2026-07-03T00:00:00Z",
    ...over,
  });

  test("self-host is always entitled + unmetered", async () => {
    const ent = await entitled(fakeEnv(), "self");
    expect(ent.entitled).toBe(true);
    expect(ent.plan_limits).toEqual({ aiPerMonth: Infinity, handoffPerMonth: Infinity });
  });

  test("cloud tenant with no snapshot fails closed", async () => {
    const ent = await entitled(fakeEnv(), "tenant_x");
    expect(ent.entitled).toBe(false);
  });

  test("synced snapshot round-trips and drives the gate; null cap → Infinity", async () => {
    const env = fakeEnv();
    await writeEntitlement(env, "tenant_42", cloudSnap());
    expect((await readEntitlement(env, "tenant_42"))?.plan).toBe("cloud");
    const ent = await entitled(env, "tenant_42");
    expect(ent.entitled).toBe(true);
    expect(ent.plan_limits.aiPerMonth).toBe(5000);
    expect(ent.plan_limits.handoffPerMonth).toBe(Infinity); // null → unmetered
    // metering vs plan: at the cap, gated
    expect(withinPlan({ ai: 5000, handoff: 0 }, ent.plan_limits)).toBe(false);
    expect(withinPlan({ ai: 4999, handoff: 1e9 }, ent.plan_limits)).toBe(true);
  });

  test("a gated (canceled/expired) snapshot revokes access", async () => {
    const env = fakeEnv();
    await writeEntitlement(env, "tenant_42", cloudSnap({ status: "canceled", entitled: false }));
    expect((await entitled(env, "tenant_42")).entitled).toBe(false);
  });
});

// ── /api/tenant/config (dashboard → tenant-config sync) ──────────────────────
describe("tenant config routes", () => {
  const SECRET = "shh";
  const req = (init: RequestInit & { path: string }) =>
    new Request(`https://edge.test${init.path}`, init);
  const authed = (extra: Record<string, string> = {}) => ({
    "x-tenant-sync-secret": SECRET,
    ...extra,
  });

  test("GET without secret → 401, no config leaked", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    await mergeTenantConfig(env, "t1", { botToken: "b", chatId: "-100" });
    const res = await worker.fetch(req({ path: "/api/tenant/config?t=t1", method: "GET" }), env);
    expect(res.status).toBe(401);
  });

  test("GET with secret, absent tenant → 404", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const res = await worker.fetch(
      req({ path: "/api/tenant/config?t=nope", method: "GET", headers: authed() }),
      env,
    );
    expect(res.status).toBe(404);
  });

  test("GET with secret returns the stored config shape getTenant() reads", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    await mergeTenantConfig(env, "t1", {
      botToken: "b",
      chatId: "-100",
      systemPrompt: "hi",
      model: "m",
    });
    const res = await worker.fetch(
      req({ path: "/api/tenant/config?t=t1", method: "GET", headers: authed() }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      botToken: "b",
      chatId: "-100",
      systemPrompt: "hi",
      model: "m",
    });
  });

  test("POST without secret → 401, nothing written", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const res = await worker.fetch(
      req({
        path: "/api/tenant/config",
        method: "POST",
        body: JSON.stringify({ tenantId: "t1", config: { botToken: "b" } }),
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(await readTenantConfig(env, "t1")).toBeNull();
  });

  test("POST merges: existing fields preserved, new fields written", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    await mergeTenantConfig(env, "t1", { botToken: "b", chatId: "-100" });
    const res = await worker.fetch(
      req({
        path: "/api/tenant/config",
        method: "POST",
        headers: authed({ "content-type": "application/json" }),
        body: JSON.stringify({ tenantId: "t1", config: { systemPrompt: "new" } }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // botToken/chatId preserved, systemPrompt added → getTenant() sees the full config
    expect(await getTenant(env, "t1")).toEqual({
      botToken: "b",
      chatId: "-100",
      systemPrompt: "new",
    });
  });

  test("round-trip: POST then GET returns the merged config", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    await worker.fetch(
      req({
        path: "/api/tenant/config",
        method: "POST",
        headers: authed(),
        body: JSON.stringify({ tenantId: "t2", config: { botToken: "b", chatId: "-200" } }),
      }),
      env,
    );
    const res = await worker.fetch(
      req({ path: "/api/tenant/config?t=t2", method: "GET", headers: authed() }),
      env,
    );
    expect(await res.json()).toEqual({ botToken: "b", chatId: "-200" });
  });
});

// ── DO fan-out ───────────────────────────────────────────────────────────────
describe("broadcast", () => {
  test("delivers to live sockets, skips dead ones", () => {
    const seen: string[] = [];
    const live = { send: (d: string) => seen.push(d) };
    const dead = {
      send: () => {
        throw new Error("closed");
      },
    };
    const n = broadcast([live, dead, live], { type: "operator", text: "hi" });
    expect(n).toBe(2);
    expect(JSON.parse(seen[0]!)).toEqual({ type: "operator", text: "hi" });
  });
});

// ── the chat flow (the whole loop, fakes for every side-effect) ──────────────
describe("chatFlow", () => {
  function deps(over: Partial<ChatDeps> = {}) {
    const topic: string[] = [];
    const metered: string[] = [];
    const base: ChatDeps = {
      systemPrompt: "sys",
      ensureTopic: async () => 5,
      toTopic: async (_t, text) => void topic.push(text),
      isHandedOff: async () => false,
      ai: async () => "Sure, 9am.",
      meter: async (k) => void metered.push(k),
      ...over,
    };
    return { base, topic, metered };
  }

  test("normal: AI answers, mirrored to topic, ai metered", async () => {
    const { base, topic, metered } = deps();
    const r = await chatFlow(base, { sessionId: "s", message: "hours?" });
    // formId rides along (null — no [!FORM:] in this reply); U3 added it to ChatResult.
    expect(r).toEqual({ reply: "Sure, 9am.", handoff: false, handedOff: false, formId: null });
    expect(topic).toContain("👤 hours?");
    expect(topic).toContain("🤖 Sure, 9am.");
    expect(metered).toEqual(["ai"]);
  });

  test("handed off: bot stays silent, still mirrors visitor msg, no AI/meter", async () => {
    let aiCalled = false;
    const { base, topic, metered } = deps({
      isHandedOff: async () => true,
      ai: async () => {
        aiCalled = true;
        return "x";
      },
    });
    const r = await chatFlow(base, { sessionId: "s", message: "still there?" });
    expect(r.handedOff).toBe(true);
    expect(r.reply).toBeNull();
    expect(aiCalled).toBe(false);
    expect(metered).toEqual([]);
    expect(topic).toContain("👤 still there?");
  });

  test("[!HANDOFF] in reply → handoff true, handoff metered", async () => {
    const { base, metered } = deps({ ai: async () => `A teammate will help. ${HANDOFF_MARKER}` });
    const r = await chatFlow(base, { sessionId: "s", message: "refund please" });
    expect(r.handoff).toBe(true);
    expect(r.reply).toBe("A teammate will help.");
    expect(metered).toEqual(["ai", "handoff"]);
  });

  test("Telegram mirror throws → AI reply still returns (mirror best-effort, P2)", async () => {
    // ensureTopic + toTopic both simulate a Telegram outage; the visitor must still get the reply.
    const { base } = deps({
      ensureTopic: async () => {
        throw new Error("telegram down");
      },
      toTopic: async () => {
        throw new Error("telegram down");
      },
      ai: async () => "We open at 9am.",
    });
    const r = await chatFlow(base, { sessionId: "s", message: "hours?" });
    expect(r.reply).toBe("We open at 9am.");
    expect(r.handoff).toBe(false);
    expect(r.handedOff).toBe(false);
  });

  test("AI throws → graceful degradation to human, never drops the visitor", async () => {
    const { base, topic } = deps({
      ai: async () => {
        throw new Error("model 500");
      },
    });
    const r = await chatFlow(base, { sessionId: "s", message: "hi" });
    expect(r.degraded).toBe(true);
    expect(r.handoff).toBe(true);
    expect(r.reply).toBe(FALLBACK_REPLY);
    expect(topic.some((t) => t.includes("AI unavailable"))).toBe(true);
  });
});

// ── turn-tax cost optimizations ──────────────────────────────────────────────
describe("system prompt brevity", () => {
  test("buildSystemPrompt appends the brevity instruction (default + custom)", () => {
    expect(buildSystemPrompt()).toContain(BREVITY_INSTRUCTION);
    expect(buildSystemPrompt("Custom voice.")).toContain(BREVITY_INSTRUCTION);
    // brevity must not clobber the handoff contract
    expect(buildSystemPrompt()).toContain(HANDOFF_MARKER);
  });
});

describe("workersAiRunner max_tokens", () => {
  const fakeAiEnv = (over: Record<string, unknown> = {}) => {
    let seen: unknown;
    const env = {
      AI: {
        run: async (_m: string, input: unknown) => {
          seen = input;
          return { response: "hi" };
        },
      },
      ...over,
    } as unknown as Env;
    return { env, input: () => seen as { max_tokens?: number } };
  };

  test("caps output at MAX_OUTPUT_TOKENS by default", async () => {
    const { env, input } = fakeAiEnv();
    await workersAiRunner(env)([{ role: "user", content: "hey" }]);
    expect(input().max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(256);
  });

  test("MAX_OUTPUT_TOKENS env overrides the cap", async () => {
    const { env, input } = fakeAiEnv({ MAX_OUTPUT_TOKENS: "128" });
    await workersAiRunner(env)([{ role: "user", content: "hey" }]);
    expect(input().max_tokens).toBe(128);
  });
});

describe("chatFlow turn-tax bounds", () => {
  function harness(over: Partial<ChatDeps> = {}) {
    let sawMessages: ChatMessage[] = [];
    const metered: string[] = [];
    let tokensMetered = 0;
    const base: ChatDeps = {
      systemPrompt: "sys",
      ensureTopic: async () => 5,
      toTopic: async () => {},
      isHandedOff: async () => false,
      ai: async (msgs) => {
        sawMessages = msgs;
        return "ok";
      },
      meter: async (k) => void metered.push(k),
      meterTokens: async (n) => void (tokensMetered += n),
      ...over,
    };
    return { base, sawMessages: () => sawMessages, metered, tokens: () => tokensMetered };
  }

  const hist = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));

  test("sliding window: AI sees at most system + MAX_HISTORY_MSGS + latest user", async () => {
    const h = harness({ history: hist(20), maxAiTurns: 999 }); // isolate from turn-count guard
    await chatFlow(h.base, { sessionId: "s", message: "now?" });
    const msgs = h.sawMessages();
    // system + 8 windowed + 1 latest user
    expect(msgs.length).toBe(1 + MAX_HISTORY_MSGS + 1);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs.at(-1)).toEqual({ role: "user", content: "now?" });
    // oldest turns trimmed: m0 must be gone, the tail (m19) kept
    expect(msgs.some((m) => m.content === "m0")).toBe(false);
    expect(msgs.some((m) => m.content === "m19")).toBe(true);
  });

  test("token metering increments with a positive estimate", async () => {
    const h = harness({ history: hist(4) });
    await chatFlow(h.base, { sessionId: "s", message: "hello there" });
    expect(h.tokens()).toBeGreaterThan(0);
    expect(h.metered).toContain("ai");
  });

  test("forces handoff at MAX_AI_TURNS without calling the AI", async () => {
    let aiCalled = false;
    // MAX_AI_TURNS assistant messages already in history
    const history: ChatMessage[] = Array.from({ length: MAX_AI_TURNS }, () => ({
      role: "assistant",
      content: "prior reply",
    }));
    const h = harness({
      history,
      ai: async () => {
        aiCalled = true;
        return "should not run";
      },
    });
    const r = await chatFlow(h.base, { sessionId: "s", message: "still stuck" });
    expect(aiCalled).toBe(false);
    expect(r.handoff).toBe(true);
    expect(r.reply).toBe(FALLBACK_REPLY);
    expect(h.metered).toEqual(["handoff"]);
  });

  test("does NOT force handoff just below the threshold", async () => {
    const history: ChatMessage[] = Array.from({ length: MAX_AI_TURNS - 1 }, () => ({
      role: "assistant",
      content: "prior reply",
    }));
    const h = harness({ history });
    const r = await chatFlow(h.base, { sessionId: "s", message: "one more" });
    expect(r.reply).toBe("ok");
    expect(r.handoff).toBe(false);
    expect(h.metered).toEqual(["ai"]);
  });
});

describe("token usage counter", () => {
  test("meter adds n (not 1) for tokens; getTokens reads back", async () => {
    const env = fakeEnv();
    await meter(env, "self", "tokens", 120);
    await meter(env, "self", "tokens", 30);
    expect(await getTokens(env, "self")).toBe(150);
    // getUsage shape stays {ai, handoff} — backward compatible
    expect(await getUsage(env, "self")).toEqual({ ai: 0, handoff: 0 });
  });
});

// ── [!FORM:<id>] marker (mirrors parseHandoff, orthogonal) ───────────────────
describe("parseForm", () => {
  test("extracts + lowercases the form id, strips the marker", () => {
    expect(parseForm("Let me grab your details. [!FORM:Book-Call]")).toEqual({
      text: "Let me grab your details.",
      formId: "book-call",
    });
  });
  test("no marker → null id, text untouched", () => {
    expect(parseForm("Just a normal reply.")).toEqual({
      text: "Just a normal reply.",
      formId: null,
    });
  });
  test("independent of [!HANDOFF] — a reply can carry both, parsed separately", () => {
    const raw = "One sec. [!HANDOFF] [!FORM:quote]";
    const { text } = parseHandoff(raw); // strips handoff only
    const form = parseForm(text); // then strips form
    expect(form.formId).toBe("quote");
    expect(form.text).toBe("One sec.");
  });
  test("buildSystemPrompt lists configured forms; omits the block when none", () => {
    const withForms = buildSystemPrompt(undefined, [{ id: "book", title: "Book a call" }]);
    expect(withForms).toContain("[!FORM:<id>]");
    expect(withForms).toContain("book (Book a call)");
    expect(buildSystemPrompt()).not.toContain("[!FORM:<id>]");
  });
});

// ── renderLeadEmail (pure) ───────────────────────────────────────────────────
describe("renderLeadEmail", () => {
  const form = {
    id: "book",
    title: "Book a call",
    fields: [
      { name: "name", label: "Your name", type: "text" as const },
      { name: "budget", label: "Budget", type: "text" as const },
    ],
  };
  test("labels values via the FormSpec + includes transcript", () => {
    const mail = renderLeadEmail(form, { name: "Dana", budget: "5k" }, [
      { role: "user", content: "hi" },
    ]);
    expect(mail.subject).toBe("New lead · Book a call");
    expect(mail.html).toContain("Your name");
    expect(mail.html).toContain("Dana");
    expect(mail.html).toContain("Budget");
    expect(mail.html).toContain("Conversation");
  });
  test("wa.me reply button only when a whatsapp phone is passed", () => {
    const without = renderLeadEmail(form, { name: "X" }, []);
    expect(without.html).not.toContain("wa.me");
    const withWa = renderLeadEmail(form, { name: "X" }, [], "972501234567");
    expect(withWa.html).toContain("https://wa.me/972501234567");
  });
  test("escapes visitor-controlled values (no HTML injection)", () => {
    const mail = renderLeadEmail(form, { name: "<script>x</script>" }, []);
    expect(mail.html).not.toContain("<script>x</script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

// ── deliverLead fan-out (telegram + email; wa/ig are CTA-only) ───────────────
describe("deliverLead fan-out", () => {
  // Capture every outbound fetch so we can assert which channels fired.
  function withCapturedFetch<T>(run: () => Promise<T>): Promise<{ urls: string[]; result: T }> {
    const urls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return run()
      .then((result) => ({ urls, result }))
      .finally(() => {
        globalThis.fetch = orig;
      });
  }

  test("fans out to Telegram + email; whatsapp/instagram never delivered server-side", async () => {
    const env = fakeEnv({ RESEND_API_KEY: "re_x", LEAD_EMAIL_FROM: "leads@x.co" });
    await mergeTenantConfig(env, "acme", {
      botToken: "tok",
      chatId: "-100",
      forms: [{ id: "book", title: "Book a call", fields: [] }],
      connectors: [
        { id: "e", type: "email", toAddress: "owner@x.co" },
        { id: "w", type: "whatsapp", phone: "972500000000" },
        { id: "i", type: "instagram", profileUrl: "https://instagram.com/x" },
      ],
    });
    await linkThreadSession(env, "acme", 42, "sess-1"); // gives getThreadForSession a hit

    const { urls } = await withCapturedFetch(() =>
      deliverLead(env, {
        tenantId: "acme",
        sessionId: "sess-1",
        formId: "book",
        values: { name: "Dana" },
        history: [{ role: "user", content: "hi" }],
      }),
    );
    // Telegram sendMessage fired…
    expect(urls.some((u) => u.includes("api.telegram.org") && u.includes("sendMessage"))).toBe(
      true,
    );
    // …and exactly one Resend email…
    expect(urls.filter((u) => u.includes("api.resend.com")).length).toBe(1);
    // …and NO wa.me / instagram delivery leaked to the server side.
    expect(urls.some((u) => u.includes("wa.me") || u.includes("instagram.com"))).toBe(false);
  });

  test("no RESEND_API_KEY → email silently skipped (Telegram still fires)", async () => {
    const env = fakeEnv(); // non-"self" tenant → getTenant reads creds from KV
    await mergeTenantConfig(env, "acme", {
      botToken: "tok",
      chatId: "-100",
      connectors: [{ id: "e", type: "email", toAddress: "owner@x.co" }],
    });
    await linkThreadSession(env, "acme", 7, "sess-2");
    const { urls } = await withCapturedFetch(() =>
      deliverLead(env, {
        tenantId: "acme",
        sessionId: "sess-2",
        formId: null,
        values: { name: "A" },
        history: [],
      }),
    );
    expect(urls.some((u) => u.includes("api.resend.com"))).toBe(false);
    expect(urls.some((u) => u.includes("api.telegram.org"))).toBe(true);
  });
});

// ── lead rate limit (anti-spam / cost on the unauth lead routes) ─────────────
describe("checkLeadRate", () => {
  test("first submits pass, over LEAD_RATE_MAX in the window → rejected", async () => {
    const env = fakeEnv();
    for (let i = 0; i < LEAD_RATE_MAX; i++) {
      expect(await checkLeadRate(env, "self", "sess-a")).toBe(true);
    }
    // one past the cap → blocked
    expect(await checkLeadRate(env, "self", "sess-a")).toBe(false);
    // a different session in the same window is independent
    expect(await checkLeadRate(env, "self", "sess-b")).toBe(true);
  });

  test("POST /api/lead over the cap returns 429", async () => {
    const env = fakeEnv();
    const post = () =>
      worker.fetch(
        new Request("https://edge.test/api/lead", {
          method: "POST",
          body: JSON.stringify({ sessionId: "s1", tenantId: "self", values: {} }),
        }),
        env,
      );
    for (let i = 0; i < LEAD_RATE_MAX; i++) expect((await post()).status).toBe(200);
    const over = await post();
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited" });
  });
});

// ── SessionDO internal auth (Worker-only /state,/operator,/handoff) ──────────
describe("SessionDO internal auth", () => {
  function fakeState() {
    const store = new Map<string, unknown>();
    return {
      acceptWebSocket: () => {},
      getWebSockets: () => [],
      storage: {
        get: async (k: string) => store.get(k),
        put: async (k: string, v: unknown) => void store.set(k, v),
      },
    } as unknown as DurableObjectState;
  }
  const env = fakeEnv();
  const secret = doInternalSecret(env);

  test("rejects an unauthenticated internal call (no secret header) → 403", async () => {
    const do_ = new SessionDO(fakeState(), env);
    const res = await do_.fetch(
      new Request("https://do/operator", {
        method: "POST",
        body: JSON.stringify({ text: "spoofed" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("accepts the internal call when the shared secret matches", async () => {
    const do_ = new SessionDO(fakeState(), env);
    const res = await do_.fetch(
      new Request("https://do/operator", {
        method: "POST",
        headers: { [DO_INTERNAL_HEADER]: secret },
        body: JSON.stringify({ text: "real operator reply" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: 0 });
  });

  test("/state also gated", async () => {
    const do_ = new SessionDO(fakeState(), env);
    expect((await do_.fetch(new Request("https://do/state"))).status).toBe(403);
    const ok = await do_.fetch(
      new Request("https://do/state", { headers: { [DO_INTERNAL_HEADER]: secret } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ handedOff: false });
  });
});
