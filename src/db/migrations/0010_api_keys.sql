-- PF-083 / ADR-036: workspace API keys. Hand-written (drizzle-kit could not run); the hand edits are
-- the grants at the end: nobody deletes a key, and only revoked_at / last_used_at can be updated.
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_scope" CHECK ("api_keys"."scope" in ('read', 'write'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_member_idx" ON "api_keys" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE POLICY "api_keys_select_own_or_admin" ON "api_keys" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("api_keys"."user_id" = (select auth.uid()) or private.has_role("api_keys"."workspace_id", array['owner', 'admin']));--> statement-breakpoint
CREATE POLICY "api_keys_insert_self" ON "api_keys" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("api_keys"."workspace_id") and "api_keys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "api_keys_update_own_or_admin" ON "api_keys" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("api_keys"."revoked_at" is null and ("api_keys"."user_id" = (select auth.uid()) or private.has_role("api_keys"."workspace_id", array['owner', 'admin']))) WITH CHECK ("api_keys"."user_id" = (select auth.uid()) or private.has_role("api_keys"."workspace_id", array['owner', 'admin']));--> statement-breakpoint
REVOKE DELETE ON TABLE "public"."api_keys" FROM "authenticated";--> statement-breakpoint
REVOKE UPDATE ON TABLE "public"."api_keys" FROM "authenticated";--> statement-breakpoint
GRANT UPDATE ("revoked_at", "last_used_at") ON TABLE "public"."api_keys" TO "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."api_keys" FROM "anon";
