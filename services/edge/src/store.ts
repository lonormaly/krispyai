// KV-backed state: tenant config, the topic<->session map, and usage metering.
// Key builders are pure (unit-tested); the KV calls are thin wrappers so the flow
// code never hand-rolls a key string.
import type { Env, TenantConfig } from "./types";

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
    return {
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      systemPrompt: env.SYSTEM_PROMPT,
      model: env.AI_MODEL,
    };
  }
  const raw = await env.KRISPY_KV.get(kTenant(tenantId));
  if (!raw) return null;
  const cfg = JSON.parse(raw) as Partial<TenantConfig>;
  return cfg.botToken && cfg.chatId ? (cfg as TenantConfig) : null;
}

// ── tenant config sync (Krispy Cloud dashboard → gate) ───────────────────────
// The dashboard (apps/web) writes a tenant's Telegram creds + prompt/model here so
// getTenant() picks them up. Same KV key + shape getTenant() reads (kTenant → a
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

// ── entitlement (Krispy Cloud billing) ───────────────────────────────────────
// The gate reads a pre-computed snapshot pushed here by @krispy/billing (the DB
// source of truth lives in the payment service / Postgres, which workerd can't
// reach — so we mirror the decision into KV over one guarded HTTP call, no polling).
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
