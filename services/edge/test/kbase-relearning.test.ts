// Kbase injection + relearning. Covers: kbSources reach the prompt; the leak-guard is
// narrowed so a bot quoting its own KB isn't flagged; suggestion dedup + FIFO cap; approve
// → kbSources + kbVersion bump, per-site isolated; the DO persists tenantId+siteId on the
// /context POST and extracts a suggestion on handback; endpoints authed + ?s= scoped.
// Run: `bun test`.
import { expect, test, describe } from "bun:test";
import worker from "../src/index";
import { SessionDO } from "../src/session-do";
import { buildSystemPrompt, detectPromptLeak } from "../src/system-prompt";
import { parseExtraction } from "../src/learn";
import {
  readSuggestions,
  appendSuggestion,
  approveSuggestion,
  removeSuggestion,
  readTenantConfig,
  mergeTenantConfig,
  normalizeQuestion,
  SUGGESTIONS_MAX,
  KB_SOURCES_MAX_CHARS,
  doInternalSecret,
  DO_INTERNAL_HEADER,
} from "../src/store";
import type { Env, KbSuggestion } from "../src/types";

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

// Map-backed DO storage with a single alarm slot (mirrors the platform), plus no-op sockets.
function fakeDOState(): DurableObjectState {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => void store.set(k, v),
      setAlarm: async (t: number | Date) => void (alarm = typeof t === "number" ? t : t.getTime()),
      deleteAlarm: async () => void (alarm = null),
      getAlarm: async () => alarm,
    },
  } as unknown as DurableObjectState;
}

const sug = (question: string, answer = "an answer"): KbSuggestion => ({
  id: crypto.randomUUID(),
  question,
  answer,
  createdAt: Date.now(),
});

// ── kbSources injection ──────────────────────────────────────────────────────
describe("buildSystemPrompt kbSources injection", () => {
  test("renders a ## Knowledge block from the tenant's sources", () => {
    const p = buildSystemPrompt("You are Bob.", undefined, undefined, [
      { id: "1", name: "Hours", text: "Open 9-5 Mon-Fri.", updatedAt: 0 },
      { id: "2", name: "Refunds", text: "30 days, no questions.", updatedAt: 0 },
    ]);
    expect(p).toContain("## Knowledge");
    expect(p).toContain("### Hours\nOpen 9-5 Mon-Fri.");
    expect(p).toContain("### Refunds\n30 days, no questions.");
  });

  test("unset kbSources → prompt identical to no-knowledge (default off)", () => {
    const withEmpty = buildSystemPrompt("You are Bob.", undefined, undefined, []);
    const without = buildSystemPrompt("You are Bob.");
    expect(withEmpty).toBe(without);
    expect(without).not.toContain("## Knowledge");
  });
});

// ── detectPromptLeak narrowing ───────────────────────────────────────────────
describe("detectPromptLeak narrowing to the instruction portion", () => {
  test("a bot quoting its own kbase verbatim is NOT a leak against the instruction scope", () => {
    const kb = [
      {
        id: "1",
        name: "Policy",
        text: "We offer a thirty day money back guarantee on all annual plans no questions asked",
        updatedAt: 0,
      },
    ];
    const full = buildSystemPrompt("You are Bob.", undefined, undefined, kb);
    const instructionScope = buildSystemPrompt("You are Bob.", undefined, undefined);
    const reply =
      "We offer a thirty day money back guarantee on all annual plans no questions asked.";
    // against the FULL prompt (knowledge included) it false-positives — the bug we fix
    expect(detectPromptLeak(reply, full)).toBe(true);
    // against the narrowed instruction-only scope it is correctly allowed
    expect(detectPromptLeak(reply, instructionScope)).toBe(false);
  });
});

// ── suggestions store: dedup + FIFO ──────────────────────────────────────────
describe("appendSuggestion dedup + FIFO cap", () => {
  test("normalizeQuestion lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeQuestion("  Do you SHIP to Canada??  ")).toBe("do you ship to canada");
  });

  test("dedups on the normalized question (punctuation/case-insensitive)", async () => {
    const env = fakeEnv();
    expect(await appendSuggestion(env, "acme", sug("Do you ship to Canada?"))).toBe(true);
    expect(await appendSuggestion(env, "acme", sug("do you ship to canada"))).toBe(false);
    expect((await readSuggestions(env, "acme")).length).toBe(1);
  });

  test("skips a question already answered by an approved kbSource", async () => {
    const env = fakeEnv();
    await mergeTenantConfig(env, "acme", {
      kbSources: [
        { id: "k", name: "Learned", text: "Q: Do you ship to Canada\nA: yes", updatedAt: 0 },
      ],
    });
    expect(await appendSuggestion(env, "acme", sug("Do you ship to Canada?"))).toBe(false);
    expect((await readSuggestions(env, "acme")).length).toBe(0);
  });

  test("FIFO cap evicts the oldest past SUGGESTIONS_MAX", async () => {
    const env = fakeEnv();
    for (let i = 0; i < SUGGESTIONS_MAX + 5; i++) {
      await appendSuggestion(env, "acme", sug(`question number ${i}`));
    }
    const list = await readSuggestions(env, "acme");
    expect(list.length).toBe(SUGGESTIONS_MAX);
    // oldest (0..4) evicted; newest survive
    expect(list[0]!.question).toBe("question number 5");
    expect(list[list.length - 1]!.question).toBe(`question number ${SUGGESTIONS_MAX + 4}`);
  });
});

// ── approve → kbSources + kbVersion + per-site isolation ─────────────────────
describe("approveSuggestion", () => {
  test("moves the suggestion into kbSources, bumps kbVersion, drops it from pending", async () => {
    const env = fakeEnv();
    const s = sug("What are your hours?", "9 to 5 weekdays");
    await appendSuggestion(env, "acme", s);
    const source = await approveSuggestion(env, "acme", s.id);
    expect(source).not.toBeNull();
    const cfg = await readTenantConfig(env, "acme");
    expect(cfg!.kbSources!.length).toBe(1);
    expect(cfg!.kbSources![0]!.text).toBe("Q: What are your hours?\nA: 9 to 5 weekdays");
    expect(cfg!.kbVersion).toBe(1);
    expect(await readSuggestions(env, "acme")).toEqual([]);
  });

  test("unknown id → null, nothing changes", async () => {
    const env = fakeEnv();
    expect(await approveSuggestion(env, "acme", "nope")).toBeNull();
  });

  test("honors the 100K kbSources cap — an approval that would exceed it is dropped, not written", async () => {
    const env = fakeEnv();
    // seed kbSources near the cap, then try to approve one more
    await mergeTenantConfig(env, "acme", {
      kbSources: [
        { id: "big", name: "big", text: "x".repeat(KB_SOURCES_MAX_CHARS - 10), updatedAt: 0 },
      ],
    });
    const s = sug("a question whose Q/A pushes total over 100K", "a long enough answer to exceed");
    await appendSuggestion(env, "acme", s);
    expect(await approveSuggestion(env, "acme", s.id)).toBeNull();
    // kbSources unchanged (still just the seed), suggestion dropped from pending
    expect((await readTenantConfig(env, "acme"))!.kbSources!.length).toBe(1);
    expect(await readSuggestions(env, "acme")).toEqual([]);
  });

  test("PER-SITE: approving a site-A suggestion never touches default or site B", async () => {
    const env = fakeEnv();
    const s = sug("site a only question");
    await appendSuggestion(env, "acme", s, "shopa");
    await approveSuggestion(env, "acme", s.id, "shopa");
    // landed on site A
    expect((await readTenantConfig(env, "acme", "shopa"))!.kbSources!.length).toBe(1);
    // default + site B untouched
    expect(await readTenantConfig(env, "acme")).toBeNull();
    expect(await readTenantConfig(env, "acme", "shopb")).toBeNull();
  });

  test("removeSuggestion (dismiss) drops the id, no KB change", async () => {
    const env = fakeEnv();
    const s = sug("dismiss me");
    await appendSuggestion(env, "acme", s);
    await removeSuggestion(env, "acme", s.id);
    expect(await readSuggestions(env, "acme")).toEqual([]);
    expect(await readTenantConfig(env, "acme")).toBeNull(); // never wrote kbSources
  });
});

// ── extraction parsing ───────────────────────────────────────────────────────
describe("parseExtraction", () => {
  test("valid JSON pair", () => {
    expect(parseExtraction('{"question":"q?","answer":"a"}')).toEqual({
      question: "q?",
      answer: "a",
    });
  });
  test("tolerates surrounding prose / code fences", () => {
    expect(parseExtraction('Here you go:\n```json\n{"question":"q","answer":"a"}\n```')).toEqual({
      question: "q",
      answer: "a",
    });
  });
  test("null / missing fields / junk → null", () => {
    expect(parseExtraction("null")).toBeNull();
    expect(parseExtraction('{"question":"q"}')).toBeNull();
    expect(parseExtraction("not json at all")).toBeNull();
  });
});

// ── DO: /context POST persists identity → handback extracts a suggestion ──────
describe("SessionDO relearning hook", () => {
  const auth = (env: Env) => ({ [DO_INTERNAL_HEADER]: doInternalSecret(env) });
  const doPost = (dobj: SessionDO, env: Env, path: string, body?: unknown) =>
    dobj.fetch(
      new Request(`https://do${path}`, {
        method: "POST",
        headers: { ...auth(env), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  test("persists tenantId+siteId on /context POST, extracts a suggestion under the per-site key on handback", async () => {
    let aiCalls = 0;
    const env = fakeEnv({
      AI: {
        run: async () => {
          aiCalls++;
          return {
            response: '{"question":"do you deliver on sundays?","answer":"yes, before noon"}',
            usage: { prompt_tokens: 100, completion_tokens: 12 },
          };
        },
      },
    } as unknown as Partial<Env>);
    // Tenant opted into the KB feature (≥1 kbSource) — relearning is enabled for it.
    await mergeTenantConfig(
      env,
      "acme",
      { kbSources: [{ id: "k", name: "Hours", text: "Open 9-5.", updatedAt: 0 }] },
      "shopa",
    );
    const dobj = new SessionDO(fakeDOState(), env);

    // The Worker's chat flow POSTs /context with the tenant identity (write-once).
    await doPost(dobj, env, "/context", { tenantId: "acme", siteId: "shopa" });
    // A visitor turn + an operator reply (operator reply also flips handedOff).
    await doPost(dobj, env, "/log", {
      messages: [{ role: "visitor", text: "do you deliver sundays?" }],
    });
    await doPost(dobj, env, "/operator", { text: "yes, before noon" });
    // Operator resolves → handback → relearning fires.
    const res = await doPost(dobj, env, "/resolve", { resolved: true });
    expect((await res.json()).resolved).toBe(true);

    expect(aiCalls).toBe(1);
    // suggestion landed under the PER-SITE key, not the default site
    const site = await readSuggestions(env, "acme", "shopa");
    expect(site.length).toBe(1);
    expect(site[0]!.question).toBe("do you deliver on sundays?");
    expect(await readSuggestions(env, "acme")).toEqual([]);
    // AI call was metered under the tenant (usage 'ai' counter written)
    expect(
      await env.KRISPY_KV.get(
        `usage:acme:${new Date().toISOString().slice(0, 7).replace("-", "")}:ai`,
      ),
    ).not.toBeNull();
  });

  test("off by default: operator handback for a tenant with NO kbSources does NOT call the AI", async () => {
    let aiCalls = 0;
    const env = fakeEnv({
      AI: {
        run: async () => (aiCalls++, { response: '{"question":"q?","answer":"a"}' }),
      },
    } as unknown as Partial<Env>);
    const dobj = new SessionDO(fakeDOState(), env);
    // No kbSources configured for acme/shopa → the tenant never opted into the KB feature.
    await doPost(dobj, env, "/context", { tenantId: "acme", siteId: "shopa" });
    await doPost(dobj, env, "/log", { messages: [{ role: "visitor", text: "help?" }] });
    await doPost(dobj, env, "/operator", { text: "here's the answer" });
    await doPost(dobj, env, "/resolve", { resolved: true });
    expect(aiCalls).toBe(0);
    expect(await readSuggestions(env, "acme", "shopa")).toEqual([]);
  });

  test("bot-only handback (no operator message) does NOT call the AI", async () => {
    let aiCalls = 0;
    const env = fakeEnv({
      AI: { run: async () => (aiCalls++, { response: "null" }) },
    } as unknown as Partial<Env>);
    const dobj = new SessionDO(fakeDOState(), env);
    await doPost(dobj, env, "/context", { tenantId: "acme", siteId: "shopa" });
    // handoff broadcast but no operator reply, then resolve
    await doPost(dobj, env, "/handoff");
    await doPost(dobj, env, "/resolve", { resolved: true });
    expect(aiCalls).toBe(0);
    expect(await readSuggestions(env, "acme", "shopa")).toEqual([]);
  });
});

// ── endpoints: auth + ?s= scoping ────────────────────────────────────────────
describe("kbase endpoints", () => {
  const SECRET = "shh";
  const req = (path: string, init: RequestInit = {}) =>
    new Request(`https://edge.test${path}`, init);
  const authed = (extra: Record<string, string> = {}) => ({
    "x-tenant-sync-secret": SECRET,
    ...extra,
  });

  test("GET kb-suggestions without secret → 401", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const res = await worker.fetch(req("/api/tenant/kb-suggestions?t=acme"), env);
    expect(res.status).toBe(401);
  });

  test("GET kb-suggestions is ?s= scoped (site A suggestion not visible on default)", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    await appendSuggestion(env, "acme", sug("scoped question"), "shopa");
    const onSite = await worker.fetch(
      req("/api/tenant/kb-suggestions?t=acme&s=shopa", { headers: authed() }),
      env,
    );
    expect((await onSite.json()).suggestions.length).toBe(1);
    const onDefault = await worker.fetch(
      req("/api/tenant/kb-suggestions?t=acme", { headers: authed() }),
      env,
    );
    expect((await onDefault.json()).suggestions).toEqual([]);
  });

  test("POST kb-approve moves to kbSources on the right site; kb-dismiss drops it", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const a = sug("approve this");
    const d = sug("dismiss this");
    await appendSuggestion(env, "acme", a, "shopa");
    await appendSuggestion(env, "acme", d, "shopa");

    const approve = await worker.fetch(
      req("/api/tenant/kb-approve", {
        method: "POST",
        headers: authed(),
        body: JSON.stringify({ tenantId: "acme", siteId: "shopa", id: a.id }),
      }),
      env,
    );
    expect(approve.status).toBe(200);
    expect((await approve.json()).ok).toBe(true);

    const dismiss = await worker.fetch(
      req("/api/tenant/kb-dismiss", {
        method: "POST",
        headers: authed(),
        body: JSON.stringify({ tenantId: "acme", siteId: "shopa", id: d.id }),
      }),
      env,
    );
    expect(dismiss.status).toBe(200);

    expect((await readTenantConfig(env, "acme", "shopa"))!.kbSources!.length).toBe(1);
    expect(await readSuggestions(env, "acme", "shopa")).toEqual([]);
  });

  test("POST kb-approve unknown id → 404", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const res = await worker.fetch(
      req("/api/tenant/kb-approve", {
        method: "POST",
        headers: authed(),
        body: JSON.stringify({ tenantId: "acme", id: "nope" }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  test("malformed ?s= → 400 invalid_site", async () => {
    const env = fakeEnv({ TENANT_SYNC_SECRET: SECRET });
    const res = await worker.fetch(
      req("/api/tenant/kb-suggestions?t=acme&s=BAD:site", { headers: authed() }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
