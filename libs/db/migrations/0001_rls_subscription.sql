-- Row-level security defense-in-depth for the tenant-owned `subscription` table.
-- See docs/design/tenant-isolation.md for the full rationale + the role/FORCE gotcha.
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE = apply RLS even to the table OWNER. Without this, the role that owns the
-- table (on Neon, the default connection role) BYPASSES every policy — the #1 way
-- RLS silently does nothing. NOTE: FORCE still does NOT cover a SUPERUSER / BYPASSRLS
-- role; the app must connect as a non-superuser role for the policies to bite
-- (verified in libs/db/src/rls.test.ts). drizzle-kit can't emit FORCE, so it's here by hand.
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscription_tenant_select" ON "subscription" AS PERMISSIVE FOR SELECT TO public USING ((tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on'));--> statement-breakpoint
CREATE POLICY "subscription_tenant_insert" ON "subscription" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on'));--> statement-breakpoint
CREATE POLICY "subscription_tenant_update" ON "subscription" AS PERMISSIVE FOR UPDATE TO public USING ((tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on')) WITH CHECK ((tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on'));--> statement-breakpoint
CREATE POLICY "subscription_tenant_delete" ON "subscription" AS PERMISSIVE FOR DELETE TO public USING ((tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on'));