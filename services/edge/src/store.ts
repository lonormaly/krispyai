// KV-backed state: tenant config, the topic<->session map, and usage metering.
// Key builders are pure (unit-tested); the KV calls are thin wrappers so the flow
// code never hand-rolls a key string.
import type {
  Connector,
  Env,
  KbSource,
  KbSuggestion,
  Operator,
  PopupSpec,
  TenantConfig,
  WidgetTheme,
} from "./types";

// CTA-capable connector types (double as visitor chat CTAs); email/telegram are
// delivery-only and never projected. Default label per type when the tenant sets none.
const DEFAULT_CTA_LABEL: Record<string, string> = {
  whatsapp: "Chat on WhatsApp",
  instagram: "DM us on Instagram",
  facebook: "Find us on Facebook",
  tiktok: "Follow on TikTok",
  phone: "Call us",
  link: "Learn more",
};

// Server-built href per type — the widget renders only what's here, never assembling a
// URL from raw phone/profile fields. wa.me/tel are the only non-https schemes allowed.
function ctaHref(c: Connector): string | undefined {
  switch (c.type) {
    case "whatsapp":
      return c.phone ? `https://wa.me/${c.phone}` : undefined;
    case "phone":
      return c.phone ? `tel:+${c.phone}` : undefined;
    case "instagram":
      return c.profileUrl;
    case "facebook":
    case "tiktok":
    case "link":
      return c.url;
    default:
      return undefined; // email/telegram — not a CTA
  }
}

// theme.popupText is sugar for a single timer popup — expand it so the widget reads one
// popups[] contract regardless of which knob the tenant set (timing supplies its defaults).
function popupTextSugar(th: WidgetTheme): PopupSpec[] {
  if (!th.popupText) return [];
  return [
    {
      trigger: { kind: "timer", delayMs: th.timing?.popupDelayMs },
      text: th.popupText,
      cooldownHours: th.timing?.popupCooldownHrs,
    },
  ];
}

// ── public widget config (secret-free whitelist) ─────────────────────────────
// The ONLY fields the unauthenticated public widget may read. Secret-free by
// construction: botToken/chatId/systemPrompt/model, operators (Telegram user ids) AND
// persona (instruction text) are structurally excluded (we project explicit keys, never
// spread cfg). The leak-guard test enforces this.
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
      glowColor: th.glowColor,
      tagline: th.tagline,
      sparkle: th.sparkle,
      direction: th.direction,
      popupText: th.popupText,
      timing: th.timing,
    },
    // CTA-capable connectors only, minus per-connector opt-outs (cta === false). Server
    // computes the href (wa.me/tel/https) + default label; a connector with no resolvable
    // href is dropped so a half-configured row never renders a dead CTA.
    ctas: (cfg?.connectors ?? [])
      .filter((c) => c.type in DEFAULT_CTA_LABEL && c.cta !== false)
      .map((c) => ({
        id: c.id,
        type: c.type,
        label: c.label ?? DEFAULT_CTA_LABEL[c.type],
        caption: c.caption,
        url: ctaHref(c),
        showAfterMs: c.showAfterMs,
      }))
      .filter((c) => c.url !== undefined),
    // Scripted opening sequence + starter chips (widget-side). Persona (tone/style) is the
    // server-only half and is NOT projected. Caps mirror the widget render limits (§3.7).
    script: {
      opening: cfg?.script?.opening?.slice(0, 5),
      starters: cfg?.script?.starters?.slice(0, 4),
    },
    // Popup engine — explicit popups[] wins; otherwise theme.popupText desugars to one
    // timer popup (back-compat). No popups + no popupText = [] (nothing ever shows).
    popups: cfg?.popups ?? popupTextSugar(th),
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

// ── multi-site namespacing ───────────────────────────────────────────────────
// One account can run many sites, each with its OWN config blob (theme, persona,
// connectors, forms, kbase) and liveness. A site is an OPTIONAL suffix on the
// tenant's KV namespace. `ns(t)` and `ns(t, "default")` collapse to the bare
// tenantId — so every EXISTING single-site tenant keeps its exact key and NOTHING
// migrates. Conversations (session/thread/DO) and billing (usage/entitlement) stay
// keyed by tenantId alone: pooled quota per account, per-site conversations deferred.
export const DEFAULT_SITE = "default";
export const ns = (tenantId: string, siteId?: string): string =>
  siteId && siteId !== DEFAULT_SITE ? `${tenantId}:${siteId}` : tenantId;

// A siteId becomes part of a `:`-delimited KV key, so it MUST be charset-bounded at
// the trust boundary (keyspace-injection guard). Returns the siteId when valid,
// undefined when absent, and null when present-but-malformed (the caller 400s).
const SITE_ID_RE = /^[a-z0-9_-]{1,40}$/;
export function resolveSiteId(raw: string | null | undefined): string | undefined | null {
  if (raw === null || raw === undefined || raw === "") return undefined;
  return SITE_ID_RE.test(raw) ? raw : null;
}

// ── key builders (pure) ──────────────────────────────────────────────────────
export const kThreadToSession = (t: string, threadId: number) => `thread:${t}:${threadId}`;
export const kSessionToThread = (t: string, sessionId: string) => `session:${t}:${sessionId}`;
// Config blob is per-site: an unsuffixed tenant keeps `tenant:<t>` exactly.
export const kTenant = (t: string, siteId?: string) => `tenant:${ns(t, siteId)}`;
// Relearning suggestions live under their OWN per-site key — NOT the config blob — so a
// machine-initiated background append (DO handback) can never race a human dashboard save.
export const kSuggestions = (t: string, siteId?: string) => `suggestions:${ns(t, siteId)}`;
/** Usage counter, bucketed by month so it doubles as a billing period. */
export const kUsage = (t: string, kind: UsageKind, yyyymm: string) =>
  `usage:${t}:${yyyymm}:${kind}`;

// "tokens" is the monthly total LLM tokens (prompt+completion); "tokens_in"/"tokens_out"
// split it so cost analytics can price input vs output separately (output ~8× pricier).
// All three take an increment `n`; "ai"/"handoff" stay +1-per-call (n defaults to 1).
export type UsageKind = "ai" | "handoff" | "tokens" | "tokens_in" | "tokens_out";

export function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── tenant config ────────────────────────────────────────────────────────────
// "self" (single-tenant self-host) is assembled from env secrets; any other
// tenant is a JSON blob in KV. Missing/incomplete config → null (Telegram off,
// chat still works — see chat flow's graceful degradation).
export async function getTenant(
  env: Env,
  tenantId: string,
  siteId?: string,
): Promise<TenantConfig | null> {
  if (tenantId === "self") {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
    // forms/connectors/theme (+ prompt/model overrides) only ever live in KV — merge
    // them in so the chat/lead path reads the SAME source as /api/widget/config.
    // Env creds win for botToken/chatId (the secrets); env prompt/model override KV
    // only when set (env unset ⇒ KV value survives).
    const kv = await readTenantConfig(env, "self", siteId);
    return {
      ...kv,
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      systemPrompt: env.SYSTEM_PROMPT ?? kv?.systemPrompt,
      model: env.AI_MODEL ?? kv?.model,
    };
  }
  const raw = await env.KRISPY_KV.get(kTenant(tenantId, siteId));
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
  siteId?: string,
): Promise<Partial<TenantConfig> | null> {
  const raw = await env.KRISPY_KV.get(kTenant(tenantId, siteId));
  return raw ? (JSON.parse(raw) as Partial<TenantConfig>) : null;
}

/** Merge `patch` into the stored config (defined fields only — never clobber unset). */
export async function mergeTenantConfig(
  env: Env,
  tenantId: string,
  patch: Partial<TenantConfig>,
  siteId?: string,
): Promise<Partial<TenantConfig>> {
  const next: Partial<TenantConfig> = { ...(await readTenantConfig(env, tenantId, siteId)) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  await env.KRISPY_KV.put(kTenant(tenantId, siteId), JSON.stringify(next));
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
    // Already known — refresh name/username/channel only if they actually changed (skip the write otherwise).
    if (
      list[i]!.name === op.name &&
      list[i]!.username === op.username &&
      list[i]!.channel === op.channel
    )
      return;
    list[i] = op;
  } else {
    list.push(op);
    if (list.length > OPERATORS_MAX) list.shift(); // evict oldest
  }
  await env.KRISPY_KV.put(kTenant(tenantId), JSON.stringify({ ...cfg, operators: list }));
}

// ── kbase relearning suggestions (per-site, own KV key) ──────────────────────
// Machine-proposed Q→A pairs from operator-touched sessions, awaiting a human's approve/
// dismiss. FIFO-capped like operators; dedup on the NORMALIZED question so an operator
// answering the same thing thrice doesn't fill the inbox thrice.
export const SUGGESTIONS_MAX = 20;

// Normalize a question for dedup: lowercase, strip punctuation, collapse whitespace.
// ponytail: exact-match after normalization; fuzzy similarity (embeddings/token-overlap)
// is the upgrade path when near-duplicates get annoying.
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readSuggestions(
  env: Env,
  tenantId: string,
  siteId?: string,
): Promise<KbSuggestion[]> {
  const raw = await env.KRISPY_KV.get(kSuggestions(tenantId, siteId));
  return raw ? (JSON.parse(raw) as KbSuggestion[]) : [];
}

/**
 * Append a suggestion unless its normalized question already matches a PENDING suggestion
 * or an APPROVED kbSource (learned sources embed the question in their text). Returns true
 * if appended, false if deduped. FIFO-evicts past SUGGESTIONS_MAX.
 * ponytail: read-modify-write on eventually-consistent KV, same race class as meter() — a
 * rare concurrent handback could lose one suggestion; its own key means it never races the
 * config blob (the load-bearing property).
 */
export async function appendSuggestion(
  env: Env,
  tenantId: string,
  suggestion: KbSuggestion,
  siteId?: string,
): Promise<boolean> {
  const norm = normalizeQuestion(suggestion.question);
  if (!norm) return false;
  const list = await readSuggestions(env, tenantId, siteId);
  if (list.some((s) => normalizeQuestion(s.question) === norm)) return false;
  const approved = (await readTenantConfig(env, tenantId, siteId))?.kbSources ?? [];
  if (approved.some((k) => normalizeQuestion(k.text).includes(norm))) return false;
  list.push(suggestion);
  while (list.length > SUGGESTIONS_MAX) list.shift(); // evict oldest
  await env.KRISPY_KV.put(kSuggestions(tenantId, siteId), JSON.stringify(list));
  return true;
}

export async function removeSuggestion(
  env: Env,
  tenantId: string,
  id: string,
  siteId?: string,
): Promise<KbSuggestion[]> {
  const list = (await readSuggestions(env, tenantId, siteId)).filter((s) => s.id !== id);
  await env.KRISPY_KV.put(kSuggestions(tenantId, siteId), JSON.stringify(list));
  return list;
}

/** Approve a suggestion: move it into the (per-site) kbSources registry as a learned
 * source, bump kbVersion, and drop it from the pending list. Returns the new source, or
 * null if the id wasn't pending. */
// Total kbSources text hard-cap — the trust-boundary invariant enforced on the config
// write path (handleTenantConfigSet). Approving a suggestion is a SECOND write door into
// kbSources, so it honors the same cap here (index.ts re-exports this for the write path).
export const KB_SOURCES_MAX_CHARS = 100_000;

export async function approveSuggestion(
  env: Env,
  tenantId: string,
  id: string,
  siteId?: string,
): Promise<KbSource | null> {
  const list = await readSuggestions(env, tenantId, siteId);
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  const cfg = await readTenantConfig(env, tenantId, siteId);
  const kbSources = cfg?.kbSources ?? [];
  const source: KbSource = {
    id: s.id,
    name: `Learned: ${s.question.slice(0, 60)}`,
    text: `Q: ${s.question}\nA: ${s.answer}`,
    updatedAt: Date.now(),
  };
  // Honor the same 100K total-text cap the config write path enforces — approvals must
  // not be a back door that grows kbSources past the invariant (it's injected whole into
  // the prompt each turn). Over the cap → drop the suggestion, don't corrupt the KB.
  const total = kbSources.reduce((n, k) => n + (k.text?.length ?? 0), 0) + source.text.length;
  if (total > KB_SOURCES_MAX_CHARS) {
    await removeSuggestion(env, tenantId, id, siteId);
    return null;
  }
  kbSources.push(source);
  await mergeTenantConfig(
    env,
    tenantId,
    { kbSources, kbVersion: (cfg?.kbVersion ?? 0) + 1 },
    siteId,
  );
  await removeSuggestion(env, tenantId, id, siteId);
  return source;
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

/** All five month-to-date counters for one tenant — the admin cost readout (in/out split
 *  so Krispy Cloud can price input vs output separately). Missing keys read as 0. */
export interface UsageDetail {
  ai: number;
  handoff: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
}
export async function getUsageDetail(env: Env, t: string): Promise<UsageDetail> {
  const m = monthKey();
  const [ai, handoff, tokens, tokensIn, tokensOut] = await Promise.all([
    env.KRISPY_KV.get(kUsage(t, "ai", m)),
    env.KRISPY_KV.get(kUsage(t, "handoff", m)),
    env.KRISPY_KV.get(kUsage(t, "tokens", m)),
    env.KRISPY_KV.get(kUsage(t, "tokens_in", m)),
    env.KRISPY_KV.get(kUsage(t, "tokens_out", m)),
  ]);
  return {
    ai: Number(ai ?? 0),
    handoff: Number(handoff ?? 0),
    tokens: Number(tokens ?? 0),
    tokensIn: Number(tokensIn ?? 0),
    tokensOut: Number(tokensOut ?? 0),
  };
}

/** Record a turn's real (or estimated) token usage: total + input/output split. */
export async function meterUsage(
  env: Env,
  t: string,
  u: { promptTokens: number; completionTokens: number },
): Promise<void> {
  await Promise.all([
    meter(env, t, "tokens", u.promptTokens + u.completionTokens),
    meter(env, t, "tokens_in", u.promptTokens),
    meter(env, t, "tokens_out", u.completionTokens),
  ]);
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
