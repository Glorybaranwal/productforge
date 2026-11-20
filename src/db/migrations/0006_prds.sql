-- PF-072 / ADR-028: PRD versions in Postgres. Hand edit: the grant at the end (nobody deletes a version).
CREATE TABLE "prds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"status" "artifact_status" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"based_on_version" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "prds_project_version_key" UNIQUE("project_id","version"),
	CONSTRAINT "prds_status" CHECK ("prds"."status" in ('DRAFT', 'APPROVED')),
	CONSTRAINT "prds_version_positive" CHECK ("prds"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "prds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prds" ADD CONSTRAINT "prds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prds" ADD CONSTRAINT "prds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prds" ADD CONSTRAINT "prds_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prds" ADD CONSTRAINT "prds_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prds_one_draft" ON "prds" USING btree ("workspace_id","project_id") WHERE "prds"."status" = 'DRAFT';--> statement-breakpoint
CREATE INDEX "prds_project_idx" ON "prds" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE POLICY "prds_select_member" ON "prds" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("prds"."workspace_id"));--> statement-breakpoint
CREATE POLICY "prds_insert_draft" ON "prds" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("prds"."workspace_id") and "prds"."status" = 'DRAFT' and "prds"."created_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "prds_update_draft" ON "prds" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("prds"."workspace_id") and "prds"."status" = 'DRAFT') WITH CHECK (private.is_member("prds"."workspace_id") and ("prds"."status" = 'DRAFT' or private.has_role("prds"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
REVOKE DELETE ON TABLE "public"."prds" FROM "authenticated";
