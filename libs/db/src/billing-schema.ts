import { relations, sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, index, pgPolicy } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Postgres row-level-security defense-in-depth (see docs/design/tenant-isolation.md).
// The USING/WITH CHECK expression: a row is visible/writable only when its
// tenant_id equals the per-request session variable `app.tenant_id` — OR the
// trusted-server bypass sentinel `app.bypass_rls` is 'on'. The `true` second arg
// to current_setting = "missing_ok" — return NULL instead of erroring when a
// variable is unset, so a connection with NEITHER context set sees no rows (fails
// closed) rather than throwing.
//
// The bypass sentinel is the webhook path (see docs/design/tenant-isolation.md §webhook):
// the Creem webhook resolves a row by provider_subscription_id with NO tenant
// context, so it runs inside withBypassRls() which sets `app.bypass_rls='on'`
// LOCAL for that one transaction. Only server code that owns the connection can
// set it — no client input ever reaches a SET.
const tenantMatch = sql`(tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on')`;

// One subscription row per tenant — the billing state for Krispy Cloud.
// Self-host (tenantId "self") never gets a row: it's free-forever and always
// entitled, so the absence of a row IS the "self-host / free" signal.
//
// The row is the source of truth the webhook writes and the entitlement gate
// reads. Statuses are absolute (the webhook SETS them from the provider event),
// which makes webhook handling idempotent by construction — applying
// `subscription.active` twice lands on the same row.
export const subscription = pgTable(
  "subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant seam (services/edge keys everything by tenantId). Unique: one
    // billing state per tenant.
    tenantId: text("tenant_id").notNull().unique(),
    // The Better Auth user who owns this subscription.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // 'free' = self-host / unmetered; 'cloud' = the paid $19/mo (or annual) plan.
    plan: text("plan").notNull().default("free"),
    // 'trialing' | 'active' | 'past_due' | 'canceled'. (Creem also emits
    // 'expired'/'paused'/'scheduled_cancel' — mapped down to these four.)
    status: text("status").notNull().default("trialing"),
    // App-owned 14-day no-card trial (set on Cloud signup, not by the provider).
    trialEndsAt: timestamp("trial_ends_at"),
    // Paid period end, from the provider's `current_period_end_date`.
    currentPeriodEnd: timestamp("current_period_end"),
    // Creem customer + subscription ids (for the portal + reconciliation).
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("subscription_user_id_idx").on(table.userId),
    index("subscription_provider_subscription_id_idx").on(table.providerSubscriptionId),
    // RLS: one policy per command. Reads/writes only ever touch the tenant whose
    // id is in `app.tenant_id` (set per-request via withTenant()). INSERT/UPDATE
    // also carry WITH CHECK so a row can't be written INTO another tenant.
    pgPolicy("subscription_tenant_select", { for: "select", using: tenantMatch }),
    pgPolicy("subscription_tenant_insert", { for: "insert", withCheck: tenantMatch }),
    pgPolicy("subscription_tenant_update", {
      for: "update",
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
    pgPolicy("subscription_tenant_delete", { for: "delete", using: tenantMatch }),
  ],
).enableRLS();

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, { fields: [subscription.userId], references: [user.id] }),
}));

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;
