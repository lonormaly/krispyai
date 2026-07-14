// In-Worker auth for the operator surface (/api/operator/* + the ?role=operator
// WS upgrade). Closes the hole where anyone could curl an operator route with any
// tenantId — the routes mutate sessions and read visitor conversations.
//
// Two accepted credentials:
//   1. Bearer token (the Buttr app) — verified by forwarding it to the cloud API's
//      GET /me (env.API_ORIGIN); the resolved user.id must equal the claimed
//      tenantId (tenantId == user.id, 1:1 — krispyai-cloud's Better Auth).
//      Browsers/RN can't set headers on a WS upgrade, so the WS path passes the
//      same token as ?auth=<token> and routes through here too.
//   2. The existing tenant-sync shared secret (x-tenant-sync-secret ==
//      TENANT_SYNC_SECRET) — server-to-server callers (CLI / Krispy Cloud),
//      trusted for any tenant. Same secret that already gates /api/tenant/config.
//
// Fail-closed: no API_ORIGIN configured → bearer tokens are rejected (a self-host
// without the cloud API uses Telegram, not the operator app; one that runs the app
// sets API_ORIGIN).
//
// CACHE TRADEOFF: verified tokens are cached in a per-isolate in-memory Map for
// AUTH_CACHE_TTL_MS (60s) so a chatty operator doesn't cost one /me subrequest per
// message. The cost: a revoked/expired session keeps working for up to 60s in a
// warm isolate, and each isolate verifies independently (cold isolate = one fresh
// /me). Acceptable for an operator console; use a shorter TTL or a KV-backed
// denylist if revocation ever needs to be instant.
import type { Env } from "./types";
import type { FetchLike } from "./telegram";

export const AUTH_CACHE_TTL_MS = 60_000;
// ponytail: crude size cap — clear the whole map past 1k entries (one tenant's
// operators never get near it). LRU if a big multi-tenant fleet ever does.
const CACHE_MAX = 1_000;

/** token → verified identity. Exported for tests only. */
export const _authCache = new Map<string, { tenantId: string; exp: number }>();

/** Pull the token out of `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string | null {
  const m = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/** Verify a bearer against the cloud API's GET /me. Returns the user's id
 * (== tenantId) or null on any failure — invalid token, no API_ORIGIN, network. */
export async function verifyBearer(
  env: Env,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const hit = _authCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.tenantId;
  if (!env.API_ORIGIN) return null; // fail closed — no verifier configured
  try {
    const res = await fetchImpl(`${env.API_ORIGIN}/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { id?: string } | null;
    if (!me?.id) return null;
    if (_authCache.size >= CACHE_MAX) _authCache.clear();
    _authCache.set(token, { tenantId: me.id, exp: Date.now() + AUTH_CACHE_TTL_MS });
    return me.id;
  } catch (e) {
    console.error("bearer verification against /me failed:", e);
    return null;
  }
}

export interface AuthDenied {
  status: 401 | 403;
  error: string;
}

/**
 * Authorize an operator-surface request for `tenantId`. Returns null when allowed,
 * else the 401/403 to send. `token` defaults to the Authorization header; the WS
 * upgrade passes its ?auth= query param instead.
 */
export async function authorizeOperator(
  request: Request,
  env: Env,
  tenantId: string,
  token: string | null = bearerToken(request),
  fetchImpl: FetchLike = fetch,
): Promise<AuthDenied | null> {
  // Server-to-server: the tenant-sync shared secret (trusted for any tenant).
  if (
    env.TENANT_SYNC_SECRET &&
    request.headers.get("x-tenant-sync-secret") === env.TENANT_SYNC_SECRET
  ) {
    return null;
  }
  if (!token) return { status: 401, error: "authorization required" };
  const resolved = await verifyBearer(env, token, fetchImpl);
  if (!resolved) return { status: 401, error: "invalid or expired token" };
  if (resolved !== tenantId) return { status: 403, error: "token does not match tenantId" };
  return null;
}
