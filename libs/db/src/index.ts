// Single public door for @krispy/db.
export { db } from "./client";
export * from "./schema";
// Better Auth's tables (user/session/account/verification) — @krispy/auth wires
// its Drizzle adapter to these so sign-up / sign-in persist to Postgres.
export * from "./auth-schema";
// Krispy Cloud billing — the per-tenant subscription table.
export * from "./billing-schema";
// Row-level-security context plumbing (per-request tenant scoping + webhook bypass).
export { withTenant, withBypassRls } from "./tenant-rls";
// Common query operators, re-exported so consumers stay on one door (no direct drizzle-orm import).
export { eq, and, or, desc, asc, sql } from "drizzle-orm";
