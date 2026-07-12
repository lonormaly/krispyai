// KV-backed state: tenant config, the topic<->session map, and usage metering.
// Key builders are pure (unit-tested); the KV calls are thin wrappers so the flow
// code never hand-rolls a key string.
import type { Env, Operator, TenantConfig } from "./types";

// ── public widget config (secret-free whitelist) ─────────────────────────────
// The ONLY fields the unauthenticated public widget may read. Secret-free by
// construction: botToken/chatId/systemPrompt/model AND operators (Telegram user ids)
// are structurally excluded (we project explicit theme keys, never spread cfg). The
// leak-guard test enforces this.
export function publicWidgetConfig(cfg: Partial<TenantConfig> | null) {
  const th = cfg?.theme ?? {};
  return {
    theme: {
      primaryColor: th.primaryColor,
      launcherColor: th.launcherColor,
      position: th.position,
      avatar: th.avatar,
      greeting: th.greeting,
      headerTitle: th.headerTitle,
      radius: th.radius,
      font: th.font,
      sound: th.sound,
    },
    // Feature A appends PUBLIC-safe form + connector-CTA projections here.
  };
}

// ── Worker→DO internal auth ──────────────────────────────────────────────────
// The DO's /state, /operator, /handoff routes are Worker-only (never the browser).
// The Worker attaches DO_INTERNAL_HEADER on every internal fetch; the DO verifies it.
// Defaults to a build-time constant (DOs aren't publicly addressable, so this closes
// a latent hole rather than a live one); override with env.DO_INTERNAL_SECRET to rotate.
export const DO_INTERNAL_HEADER = "x-krispy-do-internal";
const DO_INTERNAL_DEFAULT = "krispy-do-internal-v1";
export function doInternalSecret(env: Env): string {
  return env.DO_INTERNAL_SECRET || DO_INTERNAL_DEFAULT;
}

// ── key builders (pure) ──────────────────────────────────────────────────────
export const kThreadToSession = (t: string, threadId: number) => `thread:${t}:${threadId}`;
export const kSessionToThread = (t: string, sessionId: string) => `session:${t}:${sessionId}`;
export const kTenant = (t: string) => `tenant:${t}`;
/** Usage counter, bucketed by month so it doubles as a billing period. */
export const kUsage = (t: string, kind: UsageKind, yyyymm: string) =>
  `usage:${t}:${yyyymm}:${kind}`;

// "tokens" tracks approximate LLM tokens (chars/4 estimate), not a call count — so the
// meter takes an increment `n`. "ai"/"handoff" stay +1-per-call (n defaults to 1).
export type UsageKind = "ai" | "handoff" | "tokens";

export function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── tenant config ────────────────────────────────────────────────────────────
// "self" (single-tenant self-host) is assembled from env secrets; any other
// tenant is a JSON blob in KV. Missing/incomplete config → null (Telegram off,
// chat still works — see chat flow's graceful degradation).
export async function getTenant(env: Env, tenantId: string): Promise<TenantConfig | null> {
  if (tenantId === "self") {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
    // forms/connectors/theme (+ prompt/model overrides) only ever live in KV — merge
    // them in so the chat/lead path reads the SAME source as /api/widget/config.
    // Env creds win for botToken/chatId (the secrets); env prompt/model override KV
    // only when set (env unset ⇒ KV value survives).
    const kv = await readTenantConfig(env, "self");
    return {
      ...kv,
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      systemPrompt: env.SYSTEM_PROMPT ?? kv?.systemPrompt,
      model: env.AI_MODEL ?? kv?.model,
    };
  }
  const raw = await env.KRISPY_KV.get(kTenant(tenantId));
  if (!raw) return null;
  const cfg = JSON.parse(raw) as Partial<TenantConfig>;
  return cfg.botToken && cfg.chatId ? (cfg as TenantConfig) : null;
}

// ── tenant config sync (krispy CLI / your own tooling → gate) ────────────────
// The `krispy` CLI (packages/cli) — or Krispy Cloud, or your own script — writes a
// tenant's Telegram creds + prompt/model here so getTenant() picks them up, via the
// POST /api/tenant/config route. Same KV key + shape getTenant() reads (kTenant → a
// Partial<TenantConfig> JSON blob). Read raw so a partial config (e.g. prompt saved
// before creds) still round-trips — getTenant() itself gates on both botToken+chatId.
export async function readTenantConfig(
  env: Env,
  tenantId: string,
): Promise<Partial<TenantConfig> | null> {
  const raw = await env.KRISPY_KV.get(kTenant(tenantId));
  return raw ? (JSON.parse(raw) as Partial<TenantConfig>) : null;
}

/** Merge `patch` into the stored config (defined fields only — never clobber unset). */
export async function mergeTenantConfig(
  env: Env,
  tenantId: string,
  patch: Partial<TenantConfig>,
): Promise<Partial<TenantConfig>> {
  const next: Partial<TenantConfig> = { ...(await readTenantConfig(env, tenantId)) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  await env.KRISPY_KV.put(kTenant(tenantId), JSON.stringify(next));
  return next;
}

// ── operators (quiet-ops handoff mention) ────────────────────────────────────
// Cap the auto-learned list so a busy group can't grow it unbounded in KV. 10 is plenty
// of humans to tag; a new operator past the cap evicts the oldest (FIFO).
export const OPERATORS_MAX = 10;

export async function getOperators(env: Env, tenantId: string): Promise<Operator[]> {
  const cfg = await readTenantConfig(env, tenantId);
  return cfg?.operators ?? [];
}

/**
 * Learn (or refresh) an operator from a topic reply: whoever replies in a managed topic
 * becomes taggable on the next handoff — zero config. Idempotent on `id` (updates
 * name/username in place); appends new ids up to OPERATORS_MAX (FIFO eviction).
 * ponytail: read-modify-write on eventually-consistent KV, same race class as meter() —
 * a rare concurrent reply could lose one learn; the next reply from that operator fixes it.
 */
export async function upsertOperator(env: Env, tenantId: string, op: Operator): Promise<void> {
  const cfg = (await readTenantConfig(env, tenantId)) ?? {};
  const list = cfg.operators ?? [];
  const i = list.findIndex((o) => o.id === op.id);
  if (i >= 0) {
    // Already known — refresh name/username only if they actually changed (skip the write otherwise).
    if (list[i]!.name === op.name && list[i]!.username === op.username) return;
    list[i] = op;
  } else {
    list.push(op);
    if (list.length > OPERATORS_MAX) list.shift(); // evict oldest
  }
  await env.KRISPY_KV.put(kTenant(tenantId), JSON.stringify({ ...cfg, operators: list }));
}

// ── topic <-> session map ────────────────────────────────────────────────────
export async function getThreadForSession(
  env: Env,
  t: string,
  sessionId: string,
): Promise<number | null> {
  const v = await env.KRISPY_KV.get(kSessionToThread(t, sessionId));
  return v ? Number(v) : null;
}

export async function getSessionForThread(
  env: Env,
  t: string,
  threadId: number,
): Promise<string | null> {
  return env.KRISPY_KV.get(kThreadToSession(t, threadId));
}

export async function linkThreadSession(
  env: Env,
  t: string,
  threadId: number,
  sessionId: string,
): Promise<void> {
  await Promise.all([
    env.KRISPY_KV.put(kThreadToSession(t, threadId), sessionId),
    env.KRISPY_KV.put(kSessionToThread(t, sessionId), String(threadId)),
  ]);
}

// ── metering ─────────────────────────────────────────────────────────────────
// `n` lets a kind add more than 1 per call (tokens); call counters pass the default 1.
// ponytail: read-modify-write on eventually-consistent KV — concurrent turns for one
// tenant can lose increments, so this UNDERCOUNTS under contention. Acceptable for soft
// caps (self-host = Infinity caps, no impact). If usage ever gates real billing, move the
// counter to a per-tenant Durable Object (single-threaded → atomic increments); the DO is
// already the strongly-consistent store for handoff. Don't add a distributed lock here.
export async function meter(env: Env, t: string, kind: UsageKind, n = 1): Promise<void> {
  const key = kUsage(t, kind, monthKey());
  const cur = Number((await env.KRISPY_KV.get(key)) ?? 0);
  await env.KRISPY_KV.put(key, String(cur + n));
}

export async function getUsage(env: Env, t: string): Promise<{ ai: number; handoff: number }> {
  const m = monthKey();
  const [ai, handoff] = await Promise.all([
    env.KRISPY_KV.get(kUsage(t, "ai", m)),
    env.KRISPY_KV.get(kUsage(t, "handoff", m)),
  ]);
  return { ai: Number(ai ?? 0), handoff: Number(handoff ?? 0) };
}

/** Approximate tokens metered this month (separate from getUsage to keep its shape). */
export async function getTokens(env: Env, t: string): Promise<number> {
  return Number((await env.KRISPY_KV.get(kUsage(t, "tokens", monthKey()))) ?? 0);
}

// ── lead rate limit ──────────────────────────────────────────────────────────
// /api/lead + /api/contact are unauthenticated and un-metered — a spam/cost vector
// (each lead can fan out a Resend email). Cap submits per (tenant, session, hour) with
// a TTL'd KV counter. First submit always passes; over LEAD_RATE_MAX in the window → 429.
// ponytail: KV read-modify-write races (a burst could slip a few over the cap) — fine for
// a coarse anti-spam bound; upgrade to a per-session DO counter if it must be exact.
export const LEAD_RATE_MAX = 10;
const LEAD_RATE_WINDOW_SEC = 3600;
const kLeadRate = (t: string, sessionId: string, hourBucket: number) =>
  `leadrate:${t}:${sessionId}:${hourBucket}`;

/** True if this lead submit is allowed; increments the window counter. */
export async function checkLeadRate(env: Env, t: string, sessionId: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (LEAD_RATE_WINDOW_SEC * 1000));
  const key = kLeadRate(t, sessionId, bucket);
  const cur = Number((await env.KRISPY_KV.get(key)) ?? 0);
  if (cur >= LEAD_RATE_MAX) return false;
  await env.KRISPY_KV.put(key, String(cur + 1), { expirationTtl: LEAD_RATE_WINDOW_SEC });
  return true;
}

// ── plan gate (seam) ─────────────────────────────────────────────────────────
export interface Plan {
  aiPerMonth: number;
  handoffPerMonth: number;
}
// ponytail: one unlimited plan. Real tiers slot in here (lookup by tenant) the day
// there's billing; the gate call site already exists so nothing downstream changes.
export const PLANS: Record<string, Plan> = {
  self: { aiPerMonth: Infinity, handoffPerMonth: Infinity },
};

export function planFor(tenantId: string): Plan {
  return PLANS[tenantId] ?? { aiPerMonth: 1000, handoffPerMonth: 1000 };
}

export function withinPlan(usage: { ai: number; handoff: number }, plan: Plan): boolean {
  return usage.ai < plan.aiPerMonth && usage.handoff < plan.handoffPerMonth;
}

// ── entitlement (optional billing hook — unused in single-tenant self-host) ──
// A gate that reads a pre-computed "is this tenant allowed" snapshot from KV. Self-host
// is single-tenant with no accounts, so nothing writes this and the gate stays open. It
// exists for a hosted/multi-tenant deployment (e.g. Krispy Cloud) to mirror a billing
// decision into KV over one guarded HTTP call (POST /api/billing/entitlement), no polling.
// A `null` limit means "unmetered" (Infinity can't survive JSON).
export const kEntitlement = (t: string) => `entitlement:${t}`;

export interface SnapshotLimits {
  aiPerMonth: number | null;
  handoffPerMonth: number | null;
}
export interface EntitlementSnapshot {
  plan: string;
  status: string;
  entitled: boolean;
  limits: SnapshotLimits;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string;
}

export interface Entitlement {
  entitled: boolean;
  plan: string;
  status: string;
  /** Usage caps as a `Plan` (null snapshot limits → Infinity), ready for withinPlan. */
  plan_limits: Plan;
}

const UNMETERED: Plan = { aiPerMonth: Infinity, handoffPerMonth: Infinity };
const cap = (n: number | null): number => (n == null ? Infinity : n);

export async function writeEntitlement(
  env: Env,
  tenantId: string,
  snap: EntitlementSnapshot,
): Promise<void> {
  await env.KRISPY_KV.put(kEntitlement(tenantId), JSON.stringify(snap));
}

export async function readEntitlement(
  env: Env,
  tenantId: string,
): Promise<EntitlementSnapshot | null> {
  const raw = await env.KRISPY_KV.get(kEntitlement(tenantId));
  return raw ? (JSON.parse(raw) as EntitlementSnapshot) : null;
}

/**
 * THE gate the Worker calls before serving Cloud features. Self-host ("self") is
 * always entitled and unmetered. A Cloud tenant is entitled per its last synced
 * snapshot; a tenant with no snapshot fails closed (no billing state = no access).
 */
export async function entitled(env: Env, tenantId: string): Promise<Entitlement> {
  if (tenantId === "self") {
    return { entitled: true, plan: "free", status: "active", plan_limits: UNMETERED };
  }
  const snap = await readEntitlement(env, tenantId);
  if (!snap) return { entitled: false, plan: "cloud", status: "none", plan_limits: UNMETERED };
  return {
    entitled: snap.entitled,
    plan: snap.plan,
    status: snap.status,
    plan_limits: {
      aiPerMonth: cap(snap.limits.aiPerMonth),
      handoffPerMonth: cap(snap.limits.handoffPerMonth),
    },
  };
}
