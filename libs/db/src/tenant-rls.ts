// Per-request RLS context plumbing. See docs/design/tenant-isolation.md.
//
// The `subscription` table has FORCE ROW LEVEL SECURITY + policies keyed off the
// session variable `app.tenant_id`. These helpers are the ONLY correct way to set
// that variable: they open a transaction and set it LOCAL (transaction-scoped).
//
// Why LOCAL is load-bearing: postgres.js pools connections and Neon/serverless
// reuses them across requests. A non-LOCAL `SET` would leak one request's tenant
// context onto the next request that borrows the same pooled connection — a
// cross-tenant data leak. `set_config(..., is_local => true)` is scoped to the
// current transaction and is auto-reset on COMMIT/ROLLBACK, so a pooled connection
// can never carry stale context. NEVER call `SET` (session-scoped) for this.
//
// We use set_config($1, $2, true) rather than `SET LOCAL app.tenant_id = <x>`
// because the latter can't bind a parameter — building it by string interpolation
// would be a SQL-injection surface on the tenant id. set_config binds cleanly.
import { sql } from "drizzle-orm";
import { db } from "./client";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction whose RLS context is pinned to `tenantId`. Every
 * query issued on the passed `tx` handle sees ONLY that tenant's rows; writes into
 * another tenant are rejected by WITH CHECK. Use this for all tenant-scoped repo
 * calls (getByTenant, applyEvent for a known tenant, …).
 *
 * IMPORTANT: queries must run on the injected `tx`, not the module-level `db` —
 * `db` is a different (context-free) connection and would see no rows under FORCE.
 */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` inside a transaction with the RLS bypass sentinel set (trusted server
 * op only — e.g. the Creem webhook, which must resolve a row by
 * provider_subscription_id with NO tenant context). Sets `app.bypass_rls='on'`
 * LOCAL, which the policies honor as an escape hatch. This is a privileged path:
 * only server code that owns the connection can reach it, and no client input ever
 * flows into the SET. Keep the work inside as small as possible.
 */
export function withBypassRls<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
