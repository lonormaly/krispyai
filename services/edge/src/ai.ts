// AI-provider adapter. Workers AI is the default (free tier, zero-config on CF).
// The seam is a single function type — swap in a BYO-key provider later without
// touching the chat flow.
import type { Env } from "./types";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Real per-turn token counts. `estimated` is true when the provider returned no
 * usage object and we fell back to a chars/4 approximation (~2× off on Hebrew). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

/** What a runner returns: the assistant text + (when the provider exposes it) the real
 * token usage. `usage` is absent when the model omits it — caller estimates instead. */
export interface AiResult {
  text: string;
  usage?: TokenUsage;
}

/** Runs a chat completion and returns the assistant text + usage. May throw (caller degrades). */
export type AiRunner = (messages: ChatMessage[]) => Promise<AiResult>;

// Free, fast, good-enough default per the product spec. Override per tenant/env.
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Output cap (turn tax): a support reply is 2–3 sentences, and output tokens are the
// pricey side (4–5× input). Capping here bounds per-turn cost hard. Env override:
// MAX_OUTPUT_TOKENS. The system prompt also asks for brevity so the cap rarely bites.
export const MAX_OUTPUT_TOKENS = 256;

/** Workers AI runner — the default provider, bound as env.AI. */
export function workersAiRunner(env: Env, model = env.AI_MODEL || DEFAULT_MODEL): AiRunner {
  const maxTokens = Number(env.MAX_OUTPUT_TOKENS) || MAX_OUTPUT_TOKENS;
  return async (messages) => {
    // Workers AI returns { response, usage:{ prompt_tokens, completion_tokens, total_tokens } }.
    // Some models omit usage → we surface undefined and the caller estimates (labelled).
    const res = (await env.AI.run(model, { messages, max_tokens: maxTokens })) as {
      response?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = res?.response?.trim();
    if (!text) throw new Error("empty AI response");
    const u = res.usage;
    const usage: TokenUsage | undefined =
      u && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number"
        ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, estimated: false }
        : undefined;
    return { text, usage };
  };
}

// Prompt caching: N/A for Workers AI — it exposes no cache_control / prefix-cache knob,
// so the static system prompt is re-billed each turn (the sliding window in chat.ts is
// what bounds that cost). ponytail: when a BYO-key provider adapter lands here (selected
// by env.AI_API_KEY), enable its prompt caching on the system-prompt prefix — Anthropic
// via a `cache_control: {type:"ephemeral"}` block on the system message, OpenAI's is
// automatic on repeated prefixes. Not built until a self-hoster leaves Workers AI.
