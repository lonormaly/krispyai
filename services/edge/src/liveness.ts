// Widget liveness — "is the widget actually live on the customer's site, and where?"
//
// The widget GETs /api/widget/config on every page load. That fetch is our free
// heartbeat: we stamp a per-tenant "last seen" record (timestamp + the embedding
// page's origin/url, read from Referer/Origin) so the dashboard can show
// "live on example.com — last seen 2m ago" instead of guessing.
//
// KV write budget: a busy site boots the widget on every page view, but KV caps
// writes at ~1/sec per key. So we THROTTLE in-isolate (same pattern as
// operator-auth's verify cache): each warm isolate writes at most once per
// THROTTLE_MS per tenant. Across isolates you get a handful of writes per window —
// well under budget — with zero extra KV *read* on the hot boot path (the throttle
// lives in memory, not KV). Stamping never throws into the boot path (best-effort).
//
// ponytail: stores only the LAST-seen origin/url (single write, no read-modify-merge
// → no cross-isolate race). Upgrade path: a bounded per-origin set ("live on these N
// domains") once multi-site lands and the key gains a site segment (seen:<t>:<site>).
import type { Env } from "./types";

export const kSeen = (tenantId: string) => `seen:${tenantId}`;
export const SEEN_THROTTLE_MS = 5 * 60_000; // one stamp per tenant per isolate per 5 min

/** One tenant's last-seen record — what the dashboard renders. */
export interface SeenRecord {
  at: number; // ms epoch of the most recent widget boot we saw
  origin?: string; // scheme+host of the embedding page (from Origin/Referer)
  url?: string; // full embedding page URL when the Referer carried it
}

// In-isolate throttle: tenantId → last ms we wrote KV for it. Bounded like the
// operator-auth cache; a single account's traffic never approaches the cap.
const lastStamp = new Map<string, number>();

/** Host (scheme+host) + full url of the page that embedded the widget, from the
 * request headers. Origin is the reliable signal; Referer adds the path when the
 * site's referrer-policy allows it. Returns {} when neither is present (e.g. a
 * server-side or same-origin fetch with no Referer). */
function embedder(request: Request): { origin?: string; url?: string } {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  if (origin && origin !== "null") {
    return { origin, url: referer || undefined };
  }
  if (referer) {
    try {
      return { origin: new URL(referer).origin, url: referer };
    } catch {
      /* malformed Referer — ignore */
    }
  }
  return {};
}

/** Best-effort stamp of the tenant's last-seen record on a widget-config fetch.
 * Throttled in-isolate; never throws (a liveness write must not break the boot). */
export async function stampSeen(env: Env, tenantId: string, request: Request): Promise<void> {
  const now = Date.now();
  const prev = lastStamp.get(tenantId);
  if (prev !== undefined && now - prev < SEEN_THROTTLE_MS) return; // throttled, no write
  // crude size cap — one account's operators never approach it; clear wholesale if a
  // large fleet ever does (matches operator-auth's cache backstop).
  if (lastStamp.size > 5000) lastStamp.clear();
  lastStamp.set(tenantId, now);
  const rec: SeenRecord = { at: now, ...embedder(request) };
  try {
    await env.KRISPY_KV.put(kSeen(tenantId), JSON.stringify(rec));
  } catch (e) {
    // Roll back the throttle so the next request retries the write.
    lastStamp.delete(tenantId);
    console.error("liveness stamp failed:", e);
  }
}

/** Read a tenant's last-seen record (null if the widget has never phoned home). */
export async function readSeen(env: Env, tenantId: string): Promise<SeenRecord | null> {
  const raw = await env.KRISPY_KV.get(kSeen(tenantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SeenRecord;
  } catch {
    return null;
  }
}
