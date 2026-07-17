// Relearning: turn an operator-touched session into a knowledge suggestion.
//
// When a handed-off session hands back to the AI (operator resolved it, or the silence
// alarm fired), the operator's answers would otherwise age out of the DO ring having
// taught the bot nothing. ONE Workers-AI call extracts at most one Q→A pair the bot
// couldn't answer but the human did, and appends it (deduped, FIFO-capped) under the
// per-site `suggestions:<ns(t,s)>` key for a human to approve into kbSources.
//
// Human-in-the-loop by design: the bot never self-modifies its KB — a suggestion only
// becomes knowledge on a tenant's explicit approve (a prompt-injection valve).
import { workersAiRunner } from "./ai";
import { appendSuggestion, meter } from "./store";
import type { Env, KbSuggestion } from "./types";

interface RingLike {
  role: "visitor" | "ai" | "operator";
  text: string;
}

const EXTRACT_PROMPT =
  "You analyze a support chat transcript between a visitor, an AI bot, and a human operator. " +
  "Extract at most ONE question the AI bot could not answer but the human operator did. " +
  'Reply with ONLY compact JSON: {"question":"…","answer":"…"} — or the literal null if ' +
  "there is no such pair. Do not add any prose, code fences, or explanation.";

const ROLE_LABEL: Record<RingLike["role"], string> = {
  visitor: "Visitor",
  ai: "Bot",
  operator: "Operator",
};

/** Parse the model's extraction reply → a {question, answer} pair, or null. Tolerant of
 * stray prose/code-fences: pulls the first JSON object and validates both fields. */
export function parseExtraction(raw: string): { question: string; answer: string } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { question?: unknown; answer?: unknown };
    const question = typeof o.question === "string" ? o.question.trim() : "";
    const answer = typeof o.answer === "string" ? o.answer.trim() : "";
    return question && answer ? { question, answer } : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: extract + append one KbSuggestion from a session's ring. Metered under the
 * `ai` usage kind (keyed by tenantId only, like every other AI call). Callers must gate on
 * "the ring has ≥1 operator message" and swallow failures — this must never break resolve.
 */
export async function proposeKbSuggestion(
  env: Env,
  tenantId: string,
  siteId: string | undefined,
  ring: RingLike[],
): Promise<void> {
  const transcript = ring
    .filter((m) => m.text)
    .map((m) => `${ROLE_LABEL[m.role]}: ${m.text}`)
    .join("\n");
  if (!transcript) return;

  const res = await workersAiRunner(env)([
    { role: "system", content: EXTRACT_PROMPT },
    { role: "user", content: transcript },
  ]);
  await meter(env, tenantId, "ai");

  const pair = parseExtraction(res.text);
  if (!pair) return;

  const suggestion: KbSuggestion = {
    id: crypto.randomUUID(),
    question: pair.question,
    answer: pair.answer,
    createdAt: Date.now(),
  };
  await appendSuggestion(env, tenantId, suggestion, siteId);
}
