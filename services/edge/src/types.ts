// Shared types + the tenant seam. Everything is keyed by tenantId (default "self")
// so the single-tenant self-host and a future multi-tenant SaaS are the same code.

export interface TenantConfig {
  /** Telegram bot token (BotFather). */
  botToken: string;
  /** Target supergroup id WITH topics enabled, e.g. -1001234567890. */
  chatId: string;
  /** Optional system-prompt override. */
  systemPrompt?: string;
  /** Optional model override. */
  model?: string;
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

  // --- misc ---
  /** CORS allow-origin for the widget. Default "*". */
  ALLOWED_ORIGIN?: string;
  /** BYO AI provider key (future adapter). */
  AI_API_KEY?: string;
  /** Shared secret guarding POST /api/billing/entitlement (billing → gate push). */
  BILLING_SYNC_SECRET?: string;
  /** Shared secret guarding /api/tenant/config (dashboard → tenant-config sync). */
  TENANT_SYNC_SECRET?: string;
}

/** Message pushed over the DO WebSocket to the visitor's browser. */
export type ServerEvent =
  | { type: "ready"; handedOff: boolean }
  | { type: "operator"; text: string }
  | { type: "handoff" }
  | { type: "resume" };
