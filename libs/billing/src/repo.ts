// DB-backed subscription store. The only place that touches Postgres; everything
// else in @krispy/billing is pure. Imports @krispy/db (a lib → lib import, allowed).
//
// RLS: `subscription` has FORCE row-level security (docs/design/tenant-isolation.md).
// Every query here runs inside a per-request context — withTenant() for the tenant-
// scoped paths, withBypassRls() for the webhook path that resolves a row by provider
// id with no tenant context. Queries MUST use the injected `tx`, not module-level
// `db` (which carries no context and would see zero rows under FORCE).
import { subscription, eq, withTenant, withBypassRls, type Subscription } from "@krispy/db";
import {
  trialEndsAt,
  toSnapshot,
  type SubStatus,
  type SubState,
  type EntitlementSnapshot,
} from "./entitlement";
import type { Plan } from "./plans";
import type { SubscriptionPatch } from "./webhook";

/** Narrow a stored row's `string` plan/status back to the pure-logic unions. */
export function rowToState(row: Subscription): SubState {
  return {
    plan: row.plan as Plan,
    status: row.status as SubStatus,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

/** The edge-gate snapshot for a DB row (pre-computes `entitled` + limits). */
export function snapshotForRow(row: Subscription, now: Date = new Date()): EntitlementSnapshot {
  return toSnapshot(rowToState(row), now);
}

/** The seam the payment router depends on — a fake stands in for `bun test`. */
export interface BillingRepo {
  startTrial(userId: string, tenantId: string): Promise<Subscription>;
  getByTenant(tenantId: string): Promise<Subscription | null>;
  applyEvent(patch: SubscriptionPatch): Promise<Subscription | null>;
}

/**
 * Grant the 14-day no-card Cloud trial. Idempotent: if a row already exists for
 * this tenant (e.g. a repeated signup hook), the existing row is returned
 * unchanged — we never restart someone's trial.
 */
async function startTrial(userId: string, tenantId: string): Promise<Subscription> {
  return withTenant(tenantId, async (tx) => {
    // INSERT under this tenant's context → the WITH CHECK policy passes (the row's
    // tenant_id matches app.tenant_id). Idempotent: an existing row conflicts and
    // is returned unchanged, so we never restart a trial.
    const inserted = await tx
      .insert(subscription)
      .values({
        tenantId,
        userId,
        plan: "cloud",
        status: "trialing",
        trialEndsAt: trialEndsAt(),
      })
      .onConflictDoNothing({ target: subscription.tenantId })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = (
      await tx.select().from(subscription).where(eq(subscription.tenantId, tenantId))
    )[0];
    if (!existing) throw new Error(`startTrial: race with no row for tenant ${tenantId}`);
    return existing;
  });
}

async function getByTenant(tenantId: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(subscription).where(eq(subscription.tenantId, tenantId));
    return rows[0] ?? null;
  });
}

/**
 * Apply a verified webhook patch to the owning row. Locates it by tenantId
 * (echoed via checkout request_id) and falls back to the provider subscription id
 * for lifecycle events that don't carry it. Sets ABSOLUTE state, so replaying the
 * same event is a no-op — webhooks are idempotent by construction. Returns the
 * updated row (for the entitlement snapshot push), or null if unattributable.
 */
async function applyEvent(patch: SubscriptionPatch): Promise<Subscription | null> {
  // Absolute state → replaying the same event lands on the same row (idempotent).
  const write = (tx: Parameters<Parameters<typeof withTenant>[1]>[0], row: Subscription) =>
    tx
      .update(subscription)
      .set({
        plan: "cloud",
        status: patch.status,
        providerSubscriptionId: patch.providerSubscriptionId ?? row.providerSubscriptionId,
        providerCustomerId: patch.providerCustomerId ?? row.providerCustomerId,
        currentPeriodEnd: patch.currentPeriodEnd ?? row.currentPeriodEnd,
      })
      .where(eq(subscription.id, row.id))
      .returning();

  // Preferred path: the event carries our tenant id (checkout echoes it via
  // request_id) → scope the whole read+write to that tenant's RLS context.
  if (patch.tenantId) {
    const tenantId = patch.tenantId;
    return withTenant(tenantId, async (tx) => {
      const row = (
        await tx.select().from(subscription).where(eq(subscription.tenantId, tenantId))
      )[0];
      if (!row) return null;
      return (await write(tx, row))[0] ?? null;
    });
  }

  // Webhook bypass path: a lifecycle event with only the provider subscription id
  // and NO tenant context. This is a trusted server op — resolve the row (and thus
  // its tenant) then apply, all inside one bypass transaction. Without this, RLS
  // would silently no-op the webhook (the #1 way RLS breaks billing).
  if (patch.providerSubscriptionId) {
    const subId = patch.providerSubscriptionId;
    return withBypassRls(async (tx) => {
      const row = (
        await tx.select().from(subscription).where(eq(subscription.providerSubscriptionId, subId))
      )[0];
      if (!row) return null;
      return (await write(tx, row))[0] ?? null;
    });
  }

  return null;
}

export const billingRepo: BillingRepo = { startTrial, getByTenant, applyEvent };
