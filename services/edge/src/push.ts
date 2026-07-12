// Expo push — the Buttr operator app's out-of-app wake on handoff. Sending is one
// HTTPS POST to the Expo Push Service (brokers both APNs and FCM).
//
// The push-token store (operator_push_token) lives in krispyai-cloud, next to the
// bearer-authed register route — so the edge Worker fetches a tenant's tokens over
// one env-configured internal endpoint. The tiny JSON contract:
//
//   GET  `${PUSH_TOKENS_URL}?t=<tenantId>`
//   hdr  x-push-tokens-secret: <PUSH_TOKENS_SECRET>       (omitted when unset)
//   →    200  { "tokens": ["ExponentPushToken[...]", ...] }   (empty array = no devices)
//
// FAILURE-TOLERANT BY CONTRACT: a push failure must NEVER break the handoff — the DO
// broadcast + Telegram alert already fired. Everything here is caught and logged; the
// function only ever resolves. Unset PUSH_TOKENS_URL → silent no-op (self-host has no app).
import type { Env } from "./types";
import type { FetchLike } from "./telegram";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Push body cap — Expo truncates long bodies anyway; keep the wire payload small. */
const BODY_MAX = 120;

/**
 * Wake the tenant's operator app(s): fetch their Expo push tokens from the cloud,
 * then fan one notification out per device. Resolves with the number of tokens
 * pushed to (0 on no-op or any failure) — never throws.
 */
export async function pushToApp(
  env: Env,
  tenantId: string,
  sessionId: string,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  try {
    if (!env.PUSH_TOKENS_URL) return 0;
    const res = await fetchImpl(`${env.PUSH_TOKENS_URL}?t=${encodeURIComponent(tenantId)}`, {
      headers: env.PUSH_TOKENS_SECRET
        ? { "x-push-tokens-secret": env.PUSH_TOKENS_SECRET }
        : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`push-tokens fetch failed: ${res.status}`);
    const { tokens } = (await res.json()) as { tokens?: string[] };
    if (!tokens?.length) return 0;

    const body = text.split("\n", 1)[0]!.slice(0, BODY_MAX);
    const messages = tokens.map((to) => ({
      to,
      title: "🙋 someone needs you",
      body,
      sound: "default",
      data: { sessionId },
    }));
    const push = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    if (!push.ok) throw new Error(`expo push failed: ${push.status}`);
    return tokens.length;
  } catch (e) {
    console.error("pushToApp failed (best-effort, handoff unaffected):", e);
    return 0;
  }
}
