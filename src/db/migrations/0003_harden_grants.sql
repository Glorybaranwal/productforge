-- ADR-023 hardening (custom migration). Supabase grants every privilege on new tables in "public"
-- to anon and authenticated. RLS filters rows for SELECT/INSERT/UPDATE/DELETE but not TRUNCATE, so
-- any signed-in user could empty a table; and visitors who aren't signed in never need our tables.
-- Keep exactly what the policies use. New tables created by this role get the same defaults.
REVOKE ALL ON TABLE "public"."workspaces", "public"."workspace_members", "public"."projects", "public"."audit_logs" FROM "anon";--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."workspaces", "public"."workspace_members", "public"."projects", "public"."audit_logs" FROM "authenticated";--> statement-breakpoint
-- The audit trail is append-only: no policy allows it, and now no privilege either.
REVOKE UPDATE, DELETE ON TABLE "public"."audit_logs" FROM "authenticated";--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM "authenticated";
