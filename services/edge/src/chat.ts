// The core loop, as an injectable flow so it's fully unit-testable (no CF, no
// network). index.ts wires the real deps; tests wire fakes.
//
//   visitor msg → mirror to owner's topic → if a human already took over, stay
//   silent (operator drives) → else ask the AI → parse the [!HANDOFF] signal →
//   mirror the AI reply to the topic → answer the visitor. If the AI throws, we
//   degrade to a human handoff rather than dropping the visitor.
import type { ChatMessage, AiResult, TokenUsage } from "./ai";
import { parseHandoff, parseForm, detectPromptLeak } from "./system-prompt";
import type { FormSpec } from "./types";

export const FALLBACK_REPLY = "Thanks — a teammate will jump in here shortly.";

// Turn tax: the client re-sends the whole history each turn, so cost is quadratic in
// conversation length. Two bounds fix that here (the single chokepoint every AI call
// routes through). Both are overridable per-deploy (index.ts reads the env vars).

// Sliding window — the AI only sees the last N prior messages. System + latest user
// are always added on top, so context stays coherent while the tail stops growing.
export const MAX_HISTORY_MSGS = 8;

// After this many AI turns in one session with no resolution, tag in a human instead
// of paying for another turn (cost + UX: no endless bot loop). Generous on purpose —
// short chats never hit it. Counted from the assistant messages in history.
export const MAX_AI_TURNS = 10;

/** Rough token count when the provider exposes none: ~4 chars/token. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

export interface ChatDeps {
  /** Ensure a Telegram topic exists for this session; return its thread id (0 = Telegram off). */
  ensureTopic: (sessionId: string, firstMessage: string) => Promise<number>;
  /** Post text into the owner's topic (no-op when Telegram off). */
  toTopic: (threadId: number, text: string) => Promise<void>;
  /** True if an operator has already taken over this session (bot must stay silent). */
  isHandedOff: (sessionId: string) => Promise<boolean>;
  /** Run the AI. May throw → graceful degradation. */
  ai: (messages: ChatMessage[]) => Promise<AiResult>;
  /** Increment a usage counter. */
  meter: (kind: "ai" | "handoff") => Promise<void>;
  /** Record real (or estimated) token usage for this turn (optional; no-op if unwired). */
  meterTokens?: (usage: TokenUsage) => Promise<void>;
  systemPrompt: string;
  /** The prompt slice detectPromptLeak checks the reply against — the INSTRUCTION portion
   * only (systemPrompt + persona + contracts), EXCLUDING any injected kbSources knowledge.
   * A bot quoting its own knowledge verbatim is correctness, not a leak. Defaults to
   * `systemPrompt` when unset (identical when no knowledge is injected). */
  leakScope?: string;
  /** Prior turns for context (optional). */
  history?: ChatMessage[];
  /** Sliding-window size the AI sees (default MAX_HISTORY_MSGS). */
  maxHistoryMsgs?: number;
  /** AI turns before forced human handoff (default MAX_AI_TURNS). */
  maxAiTurns?: number;
}

export interface ChatInput {
  sessionId: string;
  message: string;
}

export interface ChatResult {
  /** Visitor-facing reply, or null when a human is driving (bot silent). */
  reply: string | null;
  /** AI asked to escalate → widget should offer contact capture. */
  handoff: boolean;
  /** An operator already owns this session. */
  handedOff: boolean;
  /** AI was unavailable and we fell back to a human. */
  degraded?: boolean;
  /** The model asked to raise this lead form (id parsed from [!FORM:<id>]). */
  formId?: string | null;
  /** The resolved FormSpec (+ CTA connectors) index.ts attaches for the widget. */
  form?: FormSpec | null;
}

export async function chatFlow(deps: ChatDeps, input: ChatInput): Promise<ChatResult> {
  // Telegram is an OPTIONAL, best-effort mirror — a Telegram outage must not reject the
  // visitor's AI reply. Wrap the passive topic ops (not the handoff/lead DELIVERY paths,
  // which live in index.ts) so a throw degrades to "AI answers, owner just misses the mirror".
  const ensureTopic = async (sessionId: string, firstMessage: string): Promise<number> => {
    try {
      return await deps.ensureTopic(sessionId, firstMessage);
    } catch (e) {
      console.error("telegram ensureTopic failed (mirror best-effort):", e);
      return 0;
    }
  };
  const toTopic = async (threadId: number, text: string): Promise<void> => {
    try {
      await deps.toTopic(threadId, text);
    } catch (e) {
      console.error("telegram toTopic failed (mirror best-effort):", e);
    }
  };

  const threadId = await ensureTopic(input.sessionId, input.message);
  // Owner always sees the visitor's message, even after handoff.
  await toTopic(threadId, `👤 ${input.message}`);

  if (await deps.isHandedOff(input.sessionId)) {
    return { reply: null, handoff: false, handedOff: true };
  }

  const history = deps.history ?? [];

  // Turn-tax guard: too many AI turns without resolution → hand to a human instead of
  // paying for another (likely-looping) turn. Counted from the assistant replies so far.
  const aiTurns = history.reduce((n, m) => n + (m.role === "assistant" ? 1 : 0), 0);
  if (aiTurns >= (deps.maxAiTurns ?? MAX_AI_TURNS)) {
    await deps.meter("handoff");
    await toTopic(threadId, "🙋 Long chat with no resolution — bringing in a human.");
    return { reply: FALLBACK_REPLY, handoff: true, handedOff: false };
  }

  // Sliding window: cap the prior turns the AI sees; system + latest user added on top.
  const windowed = history.slice(-(deps.maxHistoryMsgs ?? MAX_HISTORY_MSGS));
  const messages: ChatMessage[] = [
    { role: "system", content: deps.systemPrompt },
    ...windowed,
    { role: "user", content: input.message },
  ];

  let raw: string;
  try {
    const res = await deps.ai(messages);
    raw = res.text;
    await deps.meter("ai");
    // Prefer the provider's REAL usage; fall back to chars/4 (labelled estimated) only
    // when the model omits it — so cost analytics knows which counts to trust.
    const usage: TokenUsage = res.usage ?? {
      promptTokens: messages.reduce((n, m) => n + estTokens(m.content), 0),
      completionTokens: estTokens(raw),
      estimated: true,
    };
    await deps.meterTokens?.(usage);
  } catch {
    // AI down — keep the loop alive by routing to a human.
    await toTopic(threadId, "⚠️ AI unavailable — visitor is waiting for you.");
    return { reply: FALLBACK_REPLY, handoff: true, handedOff: false, degraded: true };
  }

  const { text, handoff } = parseHandoff(raw);
  // Orthogonal form marker — parsed off the already-handoff-stripped text.
  const { text: clean, formId } = parseForm(text);

  // Output guardrail: a jailbroken model can leak its system prompt or re-emit control
  // tokens despite SECURITY_INSTRUCTION. Deterministic, zero-latency catch on the
  // already-stripped visitor text — on a hit, never show the leak: swallow the reply
  // and pull in a human (a leak attempt means a hostile visitor worth an operator's eyes).
  if (detectPromptLeak(clean, deps.leakScope ?? deps.systemPrompt)) {
    console.warn("prompt_leak_suppressed");
    await deps.meter("handoff");
    await toTopic(threadId, "🛡️ Suppressed a suspected prompt-leak — bringing in a human.");
    return { reply: FALLBACK_REPLY, handoff: true, handedOff: false };
  }

  if (handoff) {
    await deps.meter("handoff");
    await toTopic(threadId, "🙋 AI asked for a human here.");
  }
  await toTopic(threadId, `🤖 ${clean}`);
  return { reply: clean, handoff, handedOff: false, formId };
}
