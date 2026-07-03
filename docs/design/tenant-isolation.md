# Design Doc — Tenant Isolation (multi-tenant data safety)

**Status:** Implemented (Postgres RLS layer) + design of record. **Owner:** (founder). **Last updated:** 2026-07-03.

> How Krispy keeps one tenant's data invisible to another, across every multi-tenant surface. The headline addition is **Postgres row-level security (RLS)** as defense-in-depth for the billing DB — but RLS is one layer of a **layered** model, and it only covers Postgres. This doc is the map of what each layer protects and, critically, **what it does not**.

Confidence tags on non-obvious claims: `high` (verified in a repo file / test) · `moderate` (design inference) · `low` (guess).

---

## 1. The layered model (read this first)

Tenant isolation is **not** a single mechanism. It is two independent layers on the DB, plus app-enforcement on the surfaces RLS can't reach. The layers are ordered by who is the *primary* control:

### Layer 1 — App-level scoping (PRIMARY control)

The first and most important control: **the server derives `tenantId` from the authenticated session and binds it to every tenant-owned query.** The client never supplies a tenant id that is trusted.

- `tenantId` is resolved server-side (Better Auth session → tenant), then threaded end-to-end: `getByTenant(tenantId)`, `applyEvent(patch{tenantId})`, entitlement checks — all keyed on it (`libs/billing/src/repo.ts`, `high`).
- Every tenant-owned query carries an explicit `WHERE tenant_id = …` (or now, an RLS context — see Layer 2). Never trust a client-supplied tenant id / pack name / resource key.
- This is the same invariant the Knowledge design relies on for pack handles ("the Worker owns the tenant→pack mapping; NEVER trust the client" — [`knowledge-memory.md`](./knowledge-memory.md) §6). Same doctrine, different resource.

**If Layer 1 is written correctly, no cross-tenant read ever happens.** So why add Layer 2?

### Layer 2 — Postgres RLS (DEFENSE-IN-DEPTH)

Layer 1 is application code, and application code has bugs: a forgotten `WHERE tenant_id`, a copy-pasted query that drops the filter, a SQL-injection hole, a new endpoint whose author didn't know the convention. Any one of these **leaks cross-tenant rows** — the exact failure that ends multi-tenant SaaS companies.

**RLS is the seatbelt.** With RLS on, a query that *forgets* the tenant filter returns **zero rows** instead of everyone's rows. The database itself enforces the boundary, independent of whether the app remembered to. It converts a whole class of "silent data leak" bugs into "feature returns nothing" bugs — loud, safe, and caught in testing.

RLS is **not** a replacement for Layer 1 (you still scope in the app — RLS with no context returns nothing, so the app must set the context). It's a backstop for when Layer 1 fails.

### Layer 3 — App-enforcement on the non-Postgres surfaces (RLS CAN'T HELP HERE)

**The important caveat: RLS only protects Postgres.** Krispy's other multi-tenant surfaces are outside the database entirely, and RLS does nothing for them. They **stay app-enforced**:

| Surface | What it holds | Isolation mechanism (NOT RLS) |
|---|---|---|
| **Workers KV — entitlement snapshots** | per-tenant `entitled`/limits pushed from billing | Key namespacing + **Worker-derived** tenant key; the Worker resolves `tenantId` from the authed request and reads only that key. No client KV key is trusted. `high` (mirrors `store.ts` `kTenant` keying) |
| **Workers KV — tenant config** | per-tenant system prompt, feature flags | Same: Worker-derived key; writes go through a guarded `POST /api/tenant/config` merge, never a raw client key. `high` |
| **ImmorTerm sidecar — knowledge packs** | per-tenant KB + visitor memory | Server-derived pack handle (`tenant-<hash(tenantId)>`), secret-guarded route (CF Access service token), **client never names a pack** — the sidecar itself has no auth ([`knowledge-memory.md`](./knowledge-memory.md) §6). `high` |

The mental model: **RLS is a Postgres feature; it protects Postgres rows and nothing else.** Every store that isn't Postgres needs its own isolation, and for Krispy that's always "the server derives the tenant handle from authenticated identity; no client input names another tenant's resource." Adding RLS must not lull anyone into thinking KV or the sidecar are now covered — they are not.

---

## 2. Scope — which tables get RLS

RLS is enabled on **tenant-owned tables only**:

- ✅ **`subscription`** — the per-tenant billing row (`tenant_id` column). RLS on. Any future tenant-scoped table (usage rows, per-tenant config that lands in PG, etc.) joins this set.
- ❌ **Better Auth's `user` / `session` / `account` / `verification`** — **NO RLS.** Auth needs cross-user reads by design (look up a user by email at sign-in, a session by token) and these tables have no `tenant_id` column. RLS here would break login. They're protected by Better Auth's own query surface, not by a tenant policy. `high`
- ❌ The demo `users`/`posts` tables — not tenant-scoped; out of scope.

Rule of thumb: **RLS goes on a table iff it has a `tenant_id` (or equivalent tenant seam) and every legitimate access is single-tenant.** A table that must be read across tenants (like auth) can't use a tenant-scoped policy.

---

## 3. The policy (implemented)

On `subscription` (`libs/db/src/billing-schema.ts` → migration `libs/db/migrations/0001_rls_subscription.sql`):

```sql
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription" FORCE  ROW LEVEL SECURITY;   -- see §4 (the gotcha)

-- One PERMISSIVE policy per command, keyed off a per-request session variable.
CREATE POLICY "subscription_tenant_select" ON "subscription" FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY "subscription_tenant_insert" ON "subscription" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY "subscription_tenant_update" ON "subscription" FOR UPDATE
  USING (…same…) WITH CHECK (…same…);
CREATE POLICY "subscription_tenant_delete" ON "subscription" FOR DELETE
  USING (…same…);
```

**Design points:**

- **Keyed off a session variable, not a hardcoded value.** `current_setting('app.tenant_id', true)` reads a per-request variable the app sets (§5). This is what makes one static policy serve every tenant.
- **The `true` second arg = `missing_ok`.** When `app.tenant_id` is unset, `current_setting(..., true)` returns `NULL` instead of raising. A `NULL` comparison is never true, so a connection with **no context sees no rows** — RLS **fails closed** (verified: `libs/db/src/rls.test.ts` "no context → zero rows"). Without the `true`, an unset variable would throw and turn every context-less query into a 500.
- **One policy per command (SELECT/INSERT/UPDATE/DELETE).** Reads use `USING`; writes carry `WITH CHECK` so a row can't be written *into* another tenant (an UPDATE can't move a row's `tenant_id` out of your scope, and an INSERT can't stamp someone else's `tenant_id`). Verified: cross-tenant UPDATE affects **0 rows** (`rls.test.ts`).
- **The `app.bypass_rls` sentinel** is the webhook escape hatch — see §6.

---

## 4. The role / FORCE gotcha (the point of the exercise)

This is the single most important operational fact about RLS, and the one that silently breaks it.

**Postgres grants two bypasses of RLS:**

1. **The table OWNER bypasses RLS by default.** `ENABLE ROW LEVEL SECURITY` alone does **nothing** to the role that owns the table. On Neon (and most managed Postgres), the default connection role **is** the owner of the tables it created — so `ENABLE` on its own leaves the app connection reading every tenant's rows, exactly as if RLS were off. → **Fix: `FORCE ROW LEVEL SECURITY`**, which applies policies even to the owner. We use FORCE for simplicity (one `ALTER`, no separate role to provision). drizzle-kit can't emit FORCE, so it's hand-added to the migration.

2. **A SUPERUSER (or a role with `BYPASSRLS`) bypasses RLS *even with FORCE*.** FORCE overrides the *owner* bypass, **not** the superuser bypass. If the app connects as a superuser-equivalent role, the policies never bite — no matter how many `FORCE`s you write.

**The decision:** **FORCE + a non-superuser app connection role.** FORCE handles the owner bypass; connecting as a non-superuser handles the superuser bypass. On Neon, verify the role in `DATABASE_URL` is **not** superuser and does **not** have `BYPASSRLS`:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;  -- both must be false
```

If the default role is superuser-equivalent, provision a dedicated non-superuser app role (`CREATE ROLE app NOLOGIN; GRANT … ON subscription TO app;`) and connect as it. This is a deployment/ops step, not code.

> **Why the task's "FORCE for simplicity" is only half the answer:** FORCE alone is sufficient *only when the app role is a non-superuser owner*. The test (`rls.test.ts`) makes this concrete — PGlite's bootstrap connection is the `postgres` **superuser**, which bypasses RLS even with FORCE, so the assertions run under `SET LOCAL ROLE app_user` (a non-superuser). That role-switch in the test **is** the proof that the real app connection must be a non-superuser. `high`

**Verification is mandatory before go-live:** confirm the app connection is actually subject to the policy — run a cross-tenant SELECT/UPDATE with a real app-role connection and assert it's empty / 0 rows. A green `rls.test.ts` proves the *policy* is correct; the *deployment* is only correct once the live role is confirmed non-superuser.

---

## 5. Per-request context plumbing — `withTenant`

The policies need `app.tenant_id` set per request. The helper (`libs/db/src/tenant-rls.ts`, exported from `@krispy/db`):

```ts
export function withTenant<T>(tenantId: string, fn: (tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);   // every query on `tx` now sees ONLY this tenant's rows
  });
}
```

**The connection-context rule (load-bearing):**

- **Always `SET LOCAL`, never `SET`.** `set_config(name, value, /* is_local */ true)` is **transaction-scoped** and auto-resets on COMMIT/ROLLBACK. This is **safe with pooled / serverless connections**: postgres.js pools connections and Neon reuses them across requests, so a **non-LOCAL `SET` would leak** one request's tenant context onto the next request that borrows the same pooled connection — a cross-tenant data leak. LOCAL guarantees a pooled connection can't carry stale context. **Never `SET` non-LOCAL for this.** `high`
- **`set_config(...)` binds the value as a parameter** — unlike `SET LOCAL app.tenant_id = <x>`, which can't bind a param and would force string interpolation of the tenant id (a SQL-injection surface). `set_config` is the injection-safe form.
- **Queries must run on the injected `tx`, not the module-level `db`.** `db` is a different (context-free) connection; under FORCE it sees zero rows. The repo enforces this — every RLS-scoped query uses `tx`.

**Where it's wired:** `libs/billing/src/repo.ts`:
- `getByTenant(tenantId)` → `withTenant(tenantId, tx => tx.select()…)`.
- `startTrial(userId, tenantId)` → `withTenant(tenantId, …)` (the INSERT's `WITH CHECK` passes because the row's `tenant_id` matches the context).
- `applyEvent(patch)` with a known `patch.tenantId` → `withTenant(patch.tenantId, …)` for the read + update.
- `applyEvent(patch)` with **only** a `providerSubscriptionId` (the webhook) → the bypass path (§6).

The `BillingRepo` interface and the in-memory fake used by `bun test` are unchanged — RLS is a property of the real DB-backed impl, transparent to callers.

---

## 6. Webhook bypass handling (the #1 way RLS breaks billing)

The Creem webhook is the tricky case. A subscription lifecycle event (`subscription.past_due`, `.canceled`, …) arrives keyed by **`provider_subscription_id`** and often carries **no tenant context** — Creem doesn't know our `tenantId` for those events. So the handler must **find the row by provider id without knowing which tenant owns it.**

Under RLS, a context-less lookup returns **nothing** → the webhook would silently no-op, leaving the subscription stuck in its old state. This is the classic RLS-breaks-billing failure: payments succeed, the DB never updates, entitlement drifts.

**The handling — an explicit, trusted-server bypass path:**

The webhook is a trusted server operation (the signature is already verified upstream in the provider adapter — `services/payment/src/provider.ts`, `high`). It runs inside `withBypassRls`, which sets the sentinel `app.bypass_rls = 'on'` **LOCAL** for that one transaction:

```ts
export function withBypassRls<T>(fn: (tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);   // resolve row by provider id (any tenant), then apply
  });
}
```

The policies honor the sentinel (`… OR current_setting('app.bypass_rls', true) = 'on'`), so the resolve-then-apply flow works. This is **resolve-then-apply inside one bypass transaction** — an implementation of the "resolve the row/tenant first via a bypass path" pattern that keeps everything on a single connection/role (no separate admin connection to provision).

**Why this is safe:**
- Only server code that owns the DB connection can call `set_config('app.bypass_rls', …)`. **No client input ever flows into a SET** — the webhook body is signature-verified and never names a SQL identifier.
- It's `LOCAL`, so the bypass evaporates at transaction end — it can't leak onto a pooled connection's next borrower.
- The bypass block is kept minimal (one resolve + one update).

**Alternative considered:** a dedicated owner/superuser admin connection (not subject to FORCE) for the webhook. Rejected for v1 — it needs a second `DATABASE_URL`/role and more infra; the sentinel achieves the same "trusted server op" property on one connection. If a future audit wants the bypass to be a *physically separate* privileged connection (so an app-role SQL-injection can't reach the sentinel), that's the upgrade path. `moderate`

> **Test coverage:** `rls.test.ts` "webhook bypass sentinel resolves a row across tenants" asserts the bypass transaction resolves a row by `provider_subscription_id` with no tenant context and updates it (affectedRows = 1) — proving the webhook won't silently no-op.

---

## 7. How RLS is tested

RLS is **Postgres-enforced, not mockable** — a unit test with a fake repo proves nothing about the policy. So the test runs a **real Postgres**: **PGlite** (`@electric-sql/pglite`, in-process WASM Postgres, supports RLS, no external DB), added as a **devDependency of `libs/db`**.

`libs/db/src/rls.test.ts` applies the **actual migration SQL** (`0000_billing.sql` + `0001_rls_subscription.sql` — not a re-derived toy schema), provisions a non-superuser `app_user` role, seeds two tenants' rows, and asserts:

1. **Isolation** — under `tenant_A` context, a SELECT returns **only** `tenant_A`'s row (`tenant_B` is invisible).
2. **Write containment** — a cross-tenant UPDATE (`WHERE tenant_id = 'tenant_B'` under `tenant_A` context) affects **0 rows**, and `tenant_B`'s row is genuinely untouched.
3. **Fails closed** — with no `app.tenant_id` set (and a non-superuser role), a SELECT returns **zero rows**.
4. **Webhook bypass** — the `app.bypass_rls` sentinel resolves a row by provider id across tenants and updates it.

**Runner:** `node --test` (the `libs/db` `test` script), **not `bun test`** — PGlite's WASM build is incompatible with Bun's runtime (`exitCode must be an integer` at import). Node 24 strips TS types natively, so the `.ts` test runs directly. The file has a guard that throws loudly if a stray `bun test` picks it up. The existing `bun test` suites (`libs/billing`, `services/payment`) are untouched and still green.

> **PGlite note:** it's a devDependency (root lockfile changes). If PGlite ever becomes unviable, the fallback is an integration test gated on `DATABASE_URL` (skips when absent) plus the manual verification in §4.

---

## 8. Summary — the invariants that must hold

1. **App-level scoping is primary** — the server derives `tenantId` from the authed session; no client-supplied tenant id / resource handle is ever trusted (all layers, all surfaces).
2. **RLS is defense-in-depth for Postgres** — a forgotten `WHERE` or an injection returns zero rows, not another tenant's data. It backstops Layer 1; it does not replace it.
3. **RLS only protects Postgres** — KV (entitlement snapshots, tenant config) and the ImmorTerm sidecar (knowledge packs) are **not** covered and stay app-enforced via Worker-derived handles / secret-guarded routes.
4. **FORCE + non-superuser role** — FORCE beats the owner bypass; a non-superuser connection beats the superuser bypass. Verify the live role has `rolsuper=false, rolbypassrls=false`.
5. **`SET LOCAL` only** (via `set_config(..., true)`) — transaction-scoped context is the only pooled-connection-safe way to set the tenant. Never session-`SET`.
6. **The webhook uses an explicit bypass** — a trusted, signature-verified server op resolves a row by provider id with no tenant context; without the bypass it silently no-ops (the #1 RLS-breaks-billing failure).

---

## Appendix — source citations

- Policy + FORCE: `libs/db/src/billing-schema.ts`, `libs/db/migrations/0001_rls_subscription.sql`.
- Context plumbing: `libs/db/src/tenant-rls.ts` (`withTenant`, `withBypassRls`), exported via `libs/db/src/index.ts`.
- Repo wiring: `libs/billing/src/repo.ts` (`startTrial`, `getByTenant`, `applyEvent`).
- Webhook flow: `services/payment/src/billing.ts` (`POST /webhook`), `services/payment/src/provider.ts` (signature verification).
- Test: `libs/db/src/rls.test.ts` (PGlite, real migration SQL, non-superuser role).
- Non-Postgres surfaces: [`knowledge-memory.md`](./knowledge-memory.md) §6 (sidecar auth boundary, Worker-derived pack handles).
