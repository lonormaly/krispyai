// Telegram Bot API — the operator's channel. Every visitor maps to one FORUM
// TOPIC in a configured supergroup, so the owner sees each conversation as its own
// thread on their phone and replies inline.
//
// `fetchImpl` is injectable so the flow is testable without hitting Telegram.

export type FetchLike = typeof fetch;

async function call<T = unknown>(
  token: string,
  method: string,
  body: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000), // don't let a stalled Telegram hang the Worker
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

/** Create a forum topic for a visitor; returns its message_thread_id. */
export async function createForumTopic(
  token: string,
  chatId: string,
  name: string,
  fetchImpl?: FetchLike,
): Promise<number> {
  const r = await call<{ message_thread_id: number }>(
    token,
    "createForumTopic",
    { chat_id: chatId, name },
    fetchImpl,
  );
  return r.message_thread_id;
}

/** Send a message into a visitor's topic. */
export async function sendToTopic(
  token: string,
  chatId: string,
  threadId: number,
  text: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  await call(
    token,
    "sendMessage",
    { chat_id: chatId, message_thread_id: threadId, text },
    fetchImpl,
  );
}

// ── webhook parsing (pure) ───────────────────────────────────────────────────
export interface OwnerReply {
  threadId: number;
  text: string;
}

interface TgUpdate {
  message?: {
    text?: string;
    message_thread_id?: number;
    forum_topic_created?: unknown;
    from?: { is_bot?: boolean };
  };
}

/**
 * Extract an owner's typed reply from a Telegram update, or null if it's not one
 * (bot echo, service message like topic-created, non-thread message, no text).
 */
export function parseOwnerReply(update: TgUpdate): OwnerReply | null {
  const m = update.message;
  if (!m) return null;
  if (m.from?.is_bot) return null; // the bot's own messages (AI mirror) — ignore
  if (m.forum_topic_created) return null; // service message, not a reply
  if (typeof m.message_thread_id !== "number") return null; // General topic — not a visitor thread
  const text = m.text?.trim();
  if (!text) return null;
  return { threadId: m.message_thread_id, text };
}
