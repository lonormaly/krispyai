// Real RLS enforcement test for the `subscription` table. RLS is Postgres-enforced,
// not mockable — so this runs a real Postgres (PGlite: in-process WASM Postgres,
// supports RLS, no external DB) and applies the ACTUAL migration SQL, then asserts
// cross-tenant isolation. See docs/design/tenant-isolation.md.
//
// Runs under `node --test` (NOT `bun test`): PGlite's WASM build is incompatible
// with Bun's runtime, and Node 24 strips TS types natively. The db `test` script
// points node at this file; the bun-test suites (billing/payment) are untouched.
//
// The role gotcha, made concrete: PGlite's bootstrap connection is the `postgres`
// SUPERUSER, which BYPASSES RLS even with FORCE. So the assertions run under
// `SET LOCAL ROLE app_user` (a non-superuser) — exactly the posture the real app
// connection must have for the policies to bite (see the migration's FORCE note).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Guard: PGlite's WASM build crashes under Bun's runtime. This file is meant for
// `node --test` (the db `test` script). If it's picked up by a stray `bun test`,
// bail loudly instead of hard-crashing the process — run `bun run test` in libs/db.
if ("Bun" in globalThis) {
  throw new Error("rls.test.ts must run under `node --test` (PGlite is incompatible with Bun).");
}

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// The migrator splits on drizzle's breakpoint marker; strip SQL comments so the
// statements execute cleanly.
function statements(file: string): string[] {
  return readFileSync(join(MIGRATIONS, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

async function freshDb(): Promise<PGlite> {
  const pg = new PGlite();
  for (const file of ["0000_billing.sql", "0001_rls_subscription.sql"]) {
    for (const stmt of statements(file)) await pg.exec(stmt);
  }
  // A non-superuser app role — the only role RLS actually constrains. GRANT the
  // same DML the app needs. This mirrors the required production connection role.
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription" TO app_user;
  `);
  // Seed a user (FK target) + two tenants' subscription rows (as superuser, bypassing RLS).
  await pg.exec(`
    INSERT INTO "user" (id, name, email, updated_at)
      VALUES ('u1','U1','u1@x.test', now());
    INSERT INTO "subscription" (tenant_id, user_id, plan, status)
      VALUES ('tenant_A','u1','cloud','active'), ('tenant_B','u1','cloud','active');
  `);
  return pg;
}

test("tenant context: a tenant sees ONLY its own row", async () => {
  const pg = await freshDb();
  await pg.exec("BEGIN");
  await pg.exec("SET LOCAL ROLE app_user");
  await pg.query("SELECT set_config('app.tenant_id', $1, true)", ["tenant_A"]);
  const rows = await pg.query<{ tenant_id: string }>(`SELECT tenant_id FROM "subscription"`);
  await pg.exec("COMMIT");
  assert.deepEqual(
    rows.rows.map((r) => r.tenant_id),
    ["tenant_A"],
    "tenant_B's row must be invisible under tenant_A context",
  );
});

test("cross-tenant UPDATE affects 0 rows (WITH CHECK + USING)", async () => {
  const pg = await freshDb();
  await pg.exec("BEGIN");
  await pg.exec("SET LOCAL ROLE app_user");
  await pg.query("SELECT set_config('app.tenant_id', $1, true)", ["tenant_A"]);
  const upd = await pg.query(
    `UPDATE "subscription" SET status = 'canceled' WHERE tenant_id = 'tenant_B'`,
  );
  await pg.exec("COMMIT");
  assert.equal(upd.affectedRows, 0, "tenant_A must not be able to touch tenant_B's row");

  // And tenant_B's row is genuinely untouched.
  const check = await pg.query<{ status: string }>(
    `SELECT status FROM "subscription" WHERE tenant_id = 'tenant_B'`,
  );
  assert.equal(check.rows[0]?.status, "active");
});

test("no context (forced, non-superuser) → zero rows, fails closed", async () => {
  const pg = await freshDb();
  await pg.exec("BEGIN");
  await pg.exec("SET LOCAL ROLE app_user");
  // app.tenant_id unset → current_setting(..., true) is NULL → no row matches.
  const rows = await pg.query(`SELECT * FROM "subscription"`);
  await pg.exec("COMMIT");
  assert.equal(rows.rows.length, 0, "a context-less connection must see nothing");
});

test("webhook bypass sentinel resolves a row across tenants", async () => {
  const pg = await freshDb();
  // Give tenant_B a provider subscription id the webhook would arrive with.
  await pg.exec(
    `UPDATE "subscription" SET provider_subscription_id = 'sub_B' WHERE tenant_id = 'tenant_B'`,
  );
  await pg.exec("BEGIN");
  await pg.exec("SET LOCAL ROLE app_user");
  await pg.query("SELECT set_config('app.bypass_rls', 'on', true)"); // trusted server op
  // Resolve by provider id with NO tenant context — the bypass path the Creem
  // webhook uses. Under plain tenant context this would return nothing.
  const found = await pg.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM "subscription" WHERE provider_subscription_id = 'sub_B'`,
  );
  const upd = await pg.query(
    `UPDATE "subscription" SET status = 'past_due' WHERE provider_subscription_id = 'sub_B'`,
  );
  await pg.exec("COMMIT");
  assert.equal(found.rows[0]?.tenant_id, "tenant_B", "bypass must resolve the row");
  assert.equal(upd.affectedRows, 1, "bypass must be able to update the resolved row");
});
