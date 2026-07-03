// The AI's instructions + the [!HANDOFF] contract.
//
// The whole product hinges on one convention: the model answers normally, and
// when it hits a wall a human should own (pricing negotiation, a complaint, a
// promise it can't make, an explicit "talk to a person") it appends the literal
// marker [!HANDOFF] at the very end of its reply. The server parses that marker
// out, still shows the human-readable text to the visitor, and kicks off the
// contact-capture / operator-ping flow.

export const HANDOFF_MARKER = "[!HANDOFF]";

// Reinforces the output-token cap (ai.ts MAX_OUTPUT_TOKENS) in words the model obeys,
// and matches the live-chat voice. Appended after the handoff contract so it never
// competes with it (a reply can still be one short sentence + the marker).
export const BREVITY_INSTRUCTION = "Keep replies under ~3 short sentences.";

const DEFAULT_PROMPT = `You are a friendly, concise live-chat assistant on a company's website.
Answer visitor questions helpfully in the visitor's own language. Keep replies short —
a sentence or two, like a real support chat, not an essay.

You cannot make promises about pricing, refunds, account changes, legal or medical
matters, or anything you're unsure of. When a visitor needs a real human — they ask
for one, they're upset, or the request is beyond you — briefly tell them you'll bring
in a teammate, then append the exact token ${HANDOFF_MARKER} on its own at the very end
of your message. Never explain the token; just append it. Do not use it for normal
questions you can answer.`;

/** Build the system prompt, letting a tenant override the whole thing. */
export function buildSystemPrompt(custom?: string): string {
  const base = custom?.trim() ? custom.trim() : DEFAULT_PROMPT;
  // Even a custom prompt must know the handoff contract, so always restate it.
  const withHandoff = custom?.includes(HANDOFF_MARKER)
    ? base
    : `${base}\n\nWhen a human should take over, append ${HANDOFF_MARKER} at the very end of your reply.`;
  return `${withHandoff}\n\n${BREVITY_INSTRUCTION}`;
}

export interface ParsedReply {
  /** Visitor-facing text with the marker stripped. */
  text: string;
  /** True when the model asked to escalate to a human. */
  handoff: boolean;
}

/** Split a raw model reply into visitor text + the handoff signal. */
export function parseHandoff(raw: string): ParsedReply {
  const handoff = raw.includes(HANDOFF_MARKER);
  const text = raw.split(HANDOFF_MARKER).join("").trim();
  return { text, handoff };
}
