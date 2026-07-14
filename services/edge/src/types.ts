// Shared types + the tenant seam. Everything is keyed by tenantId (default "self")
// so the single-tenant self-host and a future multi-tenant SaaS are the same code.

// ── Connectors + Lead (Feature A) ─────────────────────────────────────────
export type FieldType = "text" | "email" | "tel" | "textarea" | "select";
export interface FormField {
  name: string; // machine key, e.g. "budget"
  label: string; // visitor-facing
  type: FieldType;
  required?: boolean;
  options?: string[]; // select only
}
export interface FormSpec {
  id: string; // referenced by [!FORM:<id>]
  title: string; // card heading, e.g. "book a call"
  fields: FormField[];
  connectorIds?: string[]; // which connectors receive this lead; default = ALL configured
}
export type ConnectorType = "email" | "telegram" | "whatsapp" | "instagram";
export interface Connector {
  id: string;
  type: ConnectorType;
  toAddress?: string; // email
  phone?: string; // whatsapp (E.164 digits, no +)
  profileUrl?: string; // instagram
  // telegram uses the existing top-level botToken/chatId — no per-connector creds
}

// ── Widget theme (Feature B) ──────────────────────────────────────────────
export interface WidgetTheme {
  primaryColor?: string; // header + visitor bubble + send button. Default gold #e39a2b
  launcherColor?: string; // FAB only (defaults to primaryColor)
  position?: "br" | "bl"; // bottom-right | bottom-left. Default "br"
  avatar?: string; // "buttr" (default, inline data-URI) | an https URL
  greeting?: string; // first bot bubble on open
  headerTitle?: string; // header text (supersedes legacy data-title)
  radius?: number; // panel/bubble corner radius px, 0–20. Default 14
  font?: string; // optional CSS font-family stack
  sound?: boolean; // notification ding on inbound message while panel closed. Default true
}

export interface TenantConfig {
  /** Telegram bot token (BotFather). */
  botToken: string;
  /** Target supergroup id WITH topics enabled, e.g. -1001234567890. */
  chatId: string;
  /** Optional system-prompt override. */
  systemPrompt?: string;
  /** Optional model override. */
  model?: string;
  /** Onboarding progress (mirrors cloud types; optional). */
  onboardingStep?: number;
  onboardingComplete?: boolean;
  /** Feature A — lead forms. */
  forms?: FormSpec[];
  /** Feature A — delivery/CTA connectors. */
  connectors?: Connector[];
  /** Feature B — widget appearance. */
  theme?: WidgetTheme;
  /** Quiet-ops — operators to @mention on handoff. Auto-learned from topic replies
   * (see upsertOperator). SECRET-ADJACENT: never expose to the public widget config. */
  operators?: Operator[];
}

// ── Quiet ops (handoff mention) ───────────────────────────────────────────
// A human the bot can tag when a conversation needs a person. `id` is the Telegram
// user id — enough for a `text_mention` entity, so tagging works even for users with
// no public @username. `username` (if set) is preferred (a plain @mention, no entity).
export interface Operator {
  id: number;
  name?: string;
  username?: string;
  /** Which channel this operator works from. Absent = 'telegram' (back-compat —
   * every pre-existing KV row has no channel). 'app' operators are skipped by the
   * Telegram @mention path so they aren't double-pinged (push + mention). */
  channel?: "telegram" | "app";
}

export interface Env {
  // --- bindings (wrangler.toml) ---
  AI: Ai;
  SESSION: DurableObjectNamespace;
  KRISPY_KV: KVNamespace;

  // --- single-tenant "self" config (secrets) ---
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  SYSTEM_PROMPT?: string;
  AI_MODEL?: string;
  // --- turn-tax cost knobs (all optional; sensible defaults in code) ---
  /** Sliding-window size the AI sees, default MAX_HISTORY_MSGS (8). */
  MAX_HISTORY_MSGS?: string;
  /** AI turns before forced human handoff, default MAX_AI_TURNS (10). */
  MAX_AI_TURNS?: string;
  /** Output token cap per reply, default MAX_OUTPUT_TOKENS (256). */
  MAX_OUTPUT_TOKENS?: string;
  /** Operator-silence minutes before a handed-off session hands back to the AI,
   * default HANDBACK_SILENCE_MINUTES (5). */
  HANDBACK_SILENCE_MINUTES?: string;

  // --- misc ---
  /** CORS allow-origin for the widget. Default "*". */
  ALLOWED_ORIGIN?: string;
  /** BYO AI provider key (future adapter). */
  AI_API_KEY?: string;
  /** Shared secret guarding POST /api/billing/entitlement (billing → gate push). */
  BILLING_SYNC_SECRET?: string;
  /** Shared secret guarding /api/tenant/config (dashboard → tenant-config sync). */
  TENANT_SYNC_SECRET?: string;
  /** Shared secret the Worker attaches to internal Worker→SessionDO calls (rotatable;
   * a build-time default is used when unset — DOs aren't publicly addressable). */
  DO_INTERNAL_SECRET?: string;

  // --- operator-app push (Buttr; optional — unset → pushToApp no-ops) ---
  /** Cloud endpoint returning a tenant's Expo push tokens (see push.ts contract). */
  PUSH_TOKENS_URL?: string;
  /** Shared secret sent as x-push-tokens-secret on the token fetch. */
  PUSH_TOKENS_SECRET?: string;

  // --- lead email (Feature A; optional — no key → email delivery no-ops) ---
  /** Resend API key for lead-email delivery (reuses the cloud's existing key). */
  RESEND_API_KEY?: string;
  /** Verified-domain from-address for lead email. */
  LEAD_EMAIL_FROM?: string;
}

/** Message pushed over the DO WebSocket to the visitor's browser. */
export type ServerEvent =
  | { type: "ready"; handedOff: boolean }
  | { type: "operator"; text: string }
  | { type: "handoff" }
  /** The AI took the session back (operator resolved it, or went silent past the
   * HANDBACK_SILENCE_MINUTES alarm). Widget drops its "human joined" framing. */
  | { type: "resume" }
  /** Live visitor/AI ring-append mirrored to `role=operator` sockets only (Buttr thread, §3d/§6). */
  | { type: "message"; role: "visitor" | "ai"; text: string; ts: number };
