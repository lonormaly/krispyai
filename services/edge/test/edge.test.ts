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
import { parseOwnerReply, sendToTopic, buildMentions, sendHandoffAlert } from "../src/telegram";
import { broadcast, SessionDO, RING_MAX, type RingMsg } from "../src/session-do";
import { pushToApp } from "../src/push";
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
  getOperators,
  upsertOperator,
  OPERATORS_MAX,
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
      list: async ({ prefix }: { prefix?: string } = {}) => ({
        keys: [...kv.keys()]
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      }),
    },
    ...extra,
  } as unknown as Env;
}

// ── a Map-backed fake DurableObjectState (storage only; sockets are no-ops) ──
function fakeDOState(): DurableObjectState {
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

/** Wire env.SESSION to REAL SessionDO instances (one per idFromName), so worker
 * routes that doFetch into the DO run end-to-end in tests. */
function wireSessionNS(env: Env): Env {
  const dos = new Map<string, SessionDO>();
  (env as { SESSION: unknown }).SESSION = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        let d = dos.get(name);
        if (!d) {
          d = new SessionDO(fakeDOState(), env);
          dos.set(name, d);
        }
        return d.fetch(input instanceof Request ? input : new Request(String(input), init));
      },
    }),
  };
  return env;
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
      from: undefined,
    });
  });
  test("surfaces `from` (id/name/username) for operator auto-learn", () => {
    expect(
      parseOwnerReply({
        message: {
          text: "on it",
          message_thread_id: 42,
          from: { is_bot: false, id: 777, first_name: "Shai", username: "shaisnir" },
        },
      }),
    ).toEqual({
      threadId: 42,
      text: "on it",
      from: { id: 777, name: "Shai", username: "shaisnir" },
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

// ── quiet-ops: silent mirrors + loud handoff mention ─────────────────────────
// A fetch fake that records the parsed JSON body of every Telegram call, so we can
// assert disable_notification and the mention entities (URLs alone can't show either).
function captureTgBodies(): { bodies: any[]; fetchImpl: typeof fetch } {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify({ ok: true, result: { message_thread_id: 1 } }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe("sendToTopic silent flag", () => {
  test("routine mirror is SILENT by default (disable_notification=true)", async () => {
    const { bodies, fetchImpl } = captureTgBodies();
    await sendToTopic("tok", "-100", 5, "👤 hi", fetchImpl);
    expect(bodies[0].disable_notification).toBe(true);
    expect(bodies[0].message_thread_id).toBe(5);
  });
  test("explicit silent=false → loud", async () => {
    const { bodies, fetchImpl } = captureTgBodies();
    await sendToTopic("tok", "-100", 5, "loud", fetchImpl, false);
    expect(bodies[0].disable_notification).toBe(false);
  });
});

describe("buildMentions", () => {
  test("username → plain @mention, no entity", () => {
    const { text, entities } = buildMentions([{ id: 1, username: "shaisnir", name: "Shai" }]);
    expect(text).toBe("@shaisnir");
    expect(entities).toEqual([]);
  });
  test("no username → text_mention entity carries the user id, offset over the name", () => {
    const { text, entities } = buildMentions([{ id: 777, name: "Shai" }]);
    expect(text).toBe("Shai");
    expect(entities).toEqual([{ type: "text_mention", offset: 0, length: 4, user: { id: 777 } }]);
  });
  test("mixed list → correct per-operator offsets", () => {
    const { text, entities } = buildMentions([
      { id: 1, username: "a" }, // "@a"
      { id: 2, name: "Bo" }, // entity over "Bo"
    ]);
    expect(text).toBe("@a Bo");
    expect(entities).toEqual([{ type: "text_mention", offset: 3, length: 2, user: { id: 2 } }]);
  });
  test("no name, no username → synthesized userN label with entity", () => {
    const { text, entities } = buildMentions([{ id: 55 }]);
    expect(text).toBe("user55");
    expect(entities[0]).toEqual({ type: "text_mention", offset: 0, length: 6, user: { id: 55 } });
  });
});

describe("sendHandoffAlert", () => {
  test("LOUD (disable_notification=false) with mention entities prepended", async () => {
    const { bodies, fetchImpl } = captureTgBodies();
    await sendHandoffAlert(
      "tok",
      "-100",
      5,
      "🙋 needs a human",
      [{ id: 777, name: "Shai" }],
      fetchImpl,
    );
    const b = bodies[0];
    expect(b.disable_notification).toBe(false);
    expect(b.text).toBe("Shai\n🙋 needs a human");
    expect(b.entities).toEqual([{ type: "text_mention", offset: 0, length: 4, user: { id: 777 } }]);
  });
  test("NO operators → still fires (loud), no mention/entities (fallback)", async () => {
    const { bodies, fetchImpl } = captureTgBodies();
    await sendHandoffAlert("tok", "-100", 5, "🙋 needs a human", [], fetchImpl);
    const b = bodies[0];
    expect(b.disable_notification).toBe(false);
    expect(b.text).toBe("🙋 needs a human");
    expect(b.entities).toBeUndefined();
  });
});

// ── quiet-ops: operator auto-learn (store) ───────────────────────────────────
describe("upsertOperator", () => {
  test("learns a new operator; getOperators reads it back", async () => {
    const env = fakeEnv();
    await mergeTenantConfig(env, "self", { botToken: "t", chatId: "-1" });
    await upsertOperator(env, "self", { id: 1, name: "Shai", username: "shaisnir" });
    expect(await getOperators(env, "self")).toEqual([
      { id: 1, name: "Shai", username: "shaisnir" },
    ]);
  });
  test("idempotent on id — refreshes name/username in place, no duplicate", async () => {
    const env = fakeEnv();
    await upsertOperator(env, "self", { id: 1, name: "Old" });
    await upsertOperator(env, "self", { id: 1, name: "New", username: "shai" });
    const ops = await getOperators(env, "self");
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ id: 1, name: "New", username: "shai" });
  });
  test("caps at OPERATORS_MAX, evicting the oldest (FIFO)", async () => {
    const env = fakeEnv();
    for (let i = 1; i <= OPERATORS_MAX + 3; i++) await upsertOperator(env, "self", { id: i });
    const ops = await getOperators(env, "self");
    expect(ops).toHaveLength(OPERATORS_MAX);
    expect(ops[0]!.id).toBe(4); // ids 1-3 evicted
    expect(ops[ops.length - 1]!.id).toBe(OPERATORS_MAX + 3);
  });
  test("preserves other tenant-config fields (doesn't clobber botToken)", async () => {
    const env = fakeEnv();
    await mergeTenantConfig(env, "self", { botToken: "keep", chatId: "-1" });
    await upsertOperator(env, "self", { id: 9 });
    const cfg = await readTenantConfig(env, "self");
    expect(cfg?.botToken).toBe("keep");
    expect(cfg?.operators).toEqual([{ id: 9 }]);
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
  const fakeState = fakeDOState; // shared module helper
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

// ── SessionDO ring buffer (operator-app thread read + inbox preview) ─────────
describe("SessionDO ring buffer", () => {
  const env = fakeEnv();
  const authed = { [DO_INTERNAL_HEADER]: doInternalSecret(env) };
  const post = (do_: SessionDO, path: string, body: unknown) =>
    do_.fetch(
      new Request(`https://do${path}`, {
        method: "POST",
        headers: authed,
        body: JSON.stringify(body),
      }),
    );
  const get = (do_: SessionDO, path: string) =>
    do_.fetch(new Request(`https://do${path}`, { headers: authed }));
  const msgs = async (do_: SessionDO): Promise<RingMsg[]> =>
    ((await (await get(do_, "/log")).json()) as { messages: RingMsg[] }).messages;

  test("appends and reads back, stamping ts when absent", async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    const res = await post(do_, "/log", {
      messages: [
        { role: "visitor", text: "hi" },
        { role: "ai", text: "hello!" },
      ],
    });
    expect(await res.json()).toEqual({ ok: true, size: 2 });
    const log = await msgs(do_);
    expect(log.map((m) => [m.role, m.text])).toEqual([
      ["visitor", "hi"],
      ["ai", "hello!"],
    ]);
    expect(typeof log[0]!.ts).toBe("number");
  });

  test(`trims to RING_MAX (${RING_MAX}) — oldest evicted`, async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    for (let i = 0; i < RING_MAX + 5; i++) {
      await post(do_, "/log", { messages: [{ role: "visitor", text: `m${i}` }] });
    }
    const log = await msgs(do_);
    expect(log).toHaveLength(RING_MAX);
    expect(log[0]!.text).toBe("m5"); // m0–m4 evicted
    expect(log[log.length - 1]!.text).toBe(`m${RING_MAX + 4}`);
  });

  test("/operator reply appends to the ring (and still flips handedOff)", async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    await post(do_, "/operator", { text: "on my way" });
    expect(await msgs(do_)).toMatchObject([{ role: "operator", text: "on my way" }]);
    expect(await (await get(do_, "/state")).json()).toEqual({ handedOff: true });
  });

  test("seed only fills an EMPTY ring (per-turn appends beat it)", async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    await post(do_, "/log", { messages: [{ role: "visitor", text: "old" }], seed: true });
    expect((await msgs(do_)).map((m) => m.text)).toEqual(["old"]); // empty → seeded
    const res = await post(do_, "/log", {
      messages: [{ role: "visitor", text: "dupe" }],
      seed: true,
    });
    expect(await res.json()).toEqual({ ok: true, seeded: false }); // non-empty → no-op
    expect((await msgs(do_)).map((m) => m.text)).toEqual(["old"]);
  });

  test("/summary = handoff flag + ring tail (empty ring → nulls)", async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    expect(await (await get(do_, "/summary")).json()).toEqual({
      handedOff: false,
      lastMessage: null,
      ts: null,
    });
    await post(do_, "/log", {
      messages: [
        { role: "visitor", text: "first" },
        { role: "ai", text: "last" },
      ],
    });
    await post(do_, "/operator", { text: "human here" });
    const s = (await (await get(do_, "/summary")).json()) as Record<string, unknown>;
    expect(s.handedOff).toBe(true);
    expect(s.lastMessage).toBe("human here");
    expect(typeof s.ts).toBe("number");
  });

  test("ring routes are internal-auth gated like the rest", async () => {
    const do_ = new SessionDO(fakeDOState(), env);
    expect((await do_.fetch(new Request("https://do/log"))).status).toBe(403);
    expect((await do_.fetch(new Request("https://do/summary"))).status).toBe(403);
  });
});

// ── operator app routes (Buttr §3a–§3c) ──────────────────────────────────────
describe("operator app routes", () => {
  const post = (path: string, body: unknown) =>
    new Request(`https://edge.test${path}`, { method: "POST", body: JSON.stringify(body) });

  test("POST /api/operator/reply → DO operator broadcast + ring + app operator learned + metered", async () => {
    const env = wireSessionNS(fakeEnv());
    const res = await worker.fetch(
      post("/api/operator/reply", {
        tenantId: "acme",
        sessionId: "s1",
        text: "on my way",
        operatorName: "Dana",
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    // the operator is learned with channel 'app' (so Telegram @mentions skip them)
    expect(await getOperators(env, "acme")).toEqual([{ id: 0, name: "Dana", channel: "app" }]);
    // metered as a handoff (same as the Telegram reply path)
    expect((await getUsage(env, "acme")).handoff).toBe(1);
    // the reply landed in the session's ring (thread read sees it)
    const thread = await worker.fetch(
      post("/api/operator/thread", { tenantId: "acme", sessionId: "s1" }),
      env,
    );
    const { messages } = (await thread.json()) as { messages: RingMsg[] };
    expect(messages.map((m) => [m.role, m.text])).toEqual([["operator", "on my way"]]);
  });

  test("reply/thread/handoffs with missing fields → 400", async () => {
    const env = wireSessionNS(fakeEnv());
    for (const [path, body] of [
      ["/api/operator/reply", { tenantId: "a", sessionId: "s" }], // no text
      ["/api/operator/reply", { sessionId: "s", text: "x" }], // no tenant
      ["/api/operator/thread", { tenantId: "a" }], // no session
      ["/api/operator/handoffs", {}], // no tenant
    ] as const) {
      expect((await worker.fetch(post(path, body), env)).status).toBe(400);
    }
  });

  test("POST /api/operator/handoffs lists ONLY handed-off sessions of the tenant, with preview", async () => {
    const env = wireSessionNS(fakeEnv());
    // three known sessions (the session→thread KV map is the index)
    await linkThreadSession(env, "acme", 1, "s-live");
    await linkThreadSession(env, "acme", 2, "s-quiet");
    await linkThreadSession(env, "other", 3, "s-foreign");
    // hand one off via the reply route
    await worker.fetch(
      post("/api/operator/reply", { tenantId: "acme", sessionId: "s-live", text: "hello there" }),
      env,
    );
    const res = await worker.fetch(post("/api/operator/handoffs", { tenantId: "acme" }), env);
    expect(res.status).toBe(200);
    const { conversations } = (await res.json()) as {
      conversations: { sessionId: string; lastMessage: string; handedOff: true; ts: number }[];
    };
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      sessionId: "s-live",
      lastMessage: "hello there",
      handedOff: true,
    });
    expect(typeof conversations[0]!.ts).toBe("number");
  });

  test("thread of an untouched session → empty messages", async () => {
    const env = wireSessionNS(fakeEnv());
    const res = await worker.fetch(
      post("/api/operator/thread", { tenantId: "acme", sessionId: "nope" }),
      env,
    );
    expect(await res.json()).toEqual({ messages: [] });
  });
});

// ── pushToApp (Expo push, failure-tolerant by contract) ──────────────────────
describe("pushToApp", () => {
  function capture(tokens: string[] | "fail" = ["ExponentPushToken[abc]"]) {
    const calls: { url: string; headers?: Record<string, string>; body?: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string> | undefined,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(input).includes("exp.host")) return Response.json({ data: [] });
      if (tokens === "fail") return new Response("boom", { status: 500 });
      return Response.json({ tokens });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  test("no PUSH_TOKENS_URL → silent no-op, zero fetches", async () => {
    const { calls, fetchImpl } = capture();
    expect(await pushToApp(fakeEnv(), "t", "s", "text", fetchImpl)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("fetches tokens (secret header, tenant param) and pushes one message per device", async () => {
    const { calls, fetchImpl } = capture(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    const env = fakeEnv({
      PUSH_TOKENS_URL: "https://cloud.test/internal/push-tokens",
      PUSH_TOKENS_SECRET: "shh",
    });
    const n = await pushToApp(env, "acme", "s-42", "help me\nsecond line ignored", fetchImpl);
    expect(n).toBe(2);
    expect(calls[0]!.url).toBe("https://cloud.test/internal/push-tokens?t=acme");
    expect(calls[0]!.headers).toEqual({ "x-push-tokens-secret": "shh" });
    expect(calls[1]!.url).toBe("https://exp.host/--/api/v2/push/send");
    expect(calls[1]!.body).toEqual([
      {
        to: "ExponentPushToken[a]",
        title: "🙋 someone needs you",
        body: "help me", // first line only
        sound: "default",
        data: { sessionId: "s-42" },
      },
      {
        to: "ExponentPushToken[b]",
        title: "🙋 someone needs you",
        body: "help me",
        sound: "default",
        data: { sessionId: "s-42" },
      },
    ]);
  });

  test("token-endpoint failure → 0, never throws (handoff unaffected)", async () => {
    const { calls, fetchImpl } = capture("fail");
    const env = fakeEnv({ PUSH_TOKENS_URL: "https://cloud.test/x" });
    expect(await pushToApp(env, "t", "s", "text", fetchImpl)).toBe(0);
    expect(calls.some((c) => c.url.includes("exp.host"))).toBe(false);
  });

  test("no registered devices → 0, no exp.host call", async () => {
    const { calls, fetchImpl } = capture([]);
    const env = fakeEnv({ PUSH_TOKENS_URL: "https://cloud.test/x" });
    expect(await pushToApp(env, "t", "s", "text", fetchImpl)).toBe(0);
    expect(calls.some((c) => c.url.includes("exp.host"))).toBe(false);
  });
});

// ── handoff integration: ring seed + app push + Telegram mention skip ────────
describe("handoff → push + mention skip (integration)", () => {
  test("[!HANDOFF]: history seeds the ring, app op pushed (not @mentioned), tg op mentioned", async () => {
    const env = wireSessionNS(
      fakeEnv({
        TELEGRAM_BOT_TOKEN: "tok",
        TELEGRAM_CHAT_ID: "-100",
        PUSH_TOKENS_URL: "https://cloud.test/internal/push-tokens",
        PUSH_TOKENS_SECRET: "shh",
        AI: { run: async () => ({ response: "One sec. [!HANDOFF]" }) } as unknown as Ai,
      }),
    );
    // one Telegram operator + one app operator already known
    await upsertOperator(env, "self", { id: 777, username: "tgop" });
    await upsertOperator(env, "self", { id: 0, name: "AppOp", channel: "app" });

    // capture every outbound fetch: Telegram, the push-token fetch, exp.host
    const calls: { url: string; body: any }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("push-tokens")) return Response.json({ tokens: ["ExponentPushToken[x]"] });
      return Response.json({ ok: true, result: { message_thread_id: 9 } });
    }) as typeof fetch;
    try {
      const res = await worker.fetch(
        new Request("https://edge.test/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "s-esc",
            tenantId: "self",
            message: "I need a human",
            history: [
              { role: "user", content: "earlier question" },
              { role: "assistant", content: "earlier answer" },
            ],
          }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { handoff: boolean }).handoff).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }

    // 1. the LOUD Telegram alert mentions the tg operator, NOT the app operator
    const alert = calls.find(
      (c) => c.url.includes("sendMessage") && c.body?.disable_notification === false,
    );
    expect(alert).toBeDefined();
    expect(alert!.body.text).toContain("@tgop");
    expect(alert!.body.text).not.toContain("AppOp");

    // 2. the app got the push instead — one Expo message with the deep-link payload
    const push = calls.find((c) => c.url.includes("exp.host"));
    expect(push).toBeDefined();
    expect(push!.body).toEqual([
      {
        to: "ExponentPushToken[x]",
        title: "🙋 someone needs you",
        body: "I need a human",
        sound: "default",
        data: { sessionId: "s-esc" },
      },
    ]);

    // 3. the ring was seeded from history + this turn appended (thread read = §3c)
    const thread = await worker.fetch(
      new Request("https://edge.test/api/operator/thread", {
        method: "POST",
        body: JSON.stringify({ tenantId: "self", sessionId: "s-esc" }),
      }),
      env,
    );
    const { messages } = (await thread.json()) as { messages: RingMsg[] };
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["visitor", "earlier question"],
      ["ai", "earlier answer"],
      ["visitor", "I need a human"],
      ["ai", "One sec."],
    ]);
  });
});
