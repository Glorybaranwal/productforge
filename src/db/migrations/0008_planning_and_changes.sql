-- PF-074 / ADR-030: sprints and requirement changes in Postgres. Hand edit: the grants at the end.
CREATE TYPE "public"."change_kind" AS ENUM('modify', 'add', 'withdraw');--> statement-breakpoint
CREATE TABLE "requirement_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" "change_kind" NOT NULL,
	"requirement_code" varchar(12),
	"from_version" integer,
	"to_version" integer,
	"before" jsonb,
	"after" jsonb,
	"reason" varchar(500) NOT NULL,
	"status" "artifact_status" NOT NULL,
	"affected" jsonb NOT NULL,
	"impact" jsonb,
	"agent_run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "requirement_changes_id_workspace_id_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "requirement_changes_project_number_key" UNIQUE("project_id","number"),
	CONSTRAINT "requirement_changes_status" CHECK ("requirement_changes"."status" in ('DRAFT', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "requirement_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "impact_reviews" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"ref" varchar(12) NOT NULL,
	"note" varchar(300) NOT NULL,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "impact_reviews_pkey" PRIMARY KEY("change_id","ref"),
	CONSTRAINT "impact_reviews_ref" CHECK ("impact_reviews"."ref" = 'PRD' or "impact_reviews"."ref" ~ '^US-[0-9]{3,}$')
);
--> statement-breakpoint
ALTER TABLE "impact_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sprint_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"velocity" integer NOT NULL,
	"start_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_settings_velocity" CHECK ("sprint_settings"."velocity" between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "sprint_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"goal" varchar(300) NOT NULL,
	"auto_goal" boolean NOT NULL,
	"capacity_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_project_number_key" UNIQUE("project_id","number"),
	CONSTRAINT "sprints_number_positive" CHECK ("sprints"."number" > 0),
	CONSTRAINT "sprints_capacity" CHECK ("sprints"."capacity_points" between 0 and 500)
);
--> statement-breakpoint
ALTER TABLE "sprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sprint_items" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"story_code" varchar(12) NOT NULL,
	"sprint_number" integer NOT NULL,
	"position" integer NOT NULL,
	"pinned" boolean NOT NULL,
	"reason" varchar(300) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_items_pkey" PRIMARY KEY("project_id","story_code"),
	CONSTRAINT "sprint_items_story_code" CHECK ("sprint_items"."story_code" ~ '^US-[0-9]{3,}$')
);
--> statement-breakpoint
ALTER TABLE "sprint_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "requirement_changes" ADD CONSTRAINT "requirement_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_changes" ADD CONSTRAINT "requirement_changes_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_changes" ADD CONSTRAINT "requirement_changes_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_reviews" ADD CONSTRAINT "impact_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_reviews" ADD CONSTRAINT "impact_reviews_change_fk" FOREIGN KEY ("change_id","workspace_id") REFERENCES "public"."requirement_changes"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_reviews" ADD CONSTRAINT "impact_reviews_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_settings" ADD CONSTRAINT "sprint_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_settings" ADD CONSTRAINT "sprint_settings_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_sprint_fk" FOREIGN KEY ("project_id","sprint_number") REFERENCES "public"."sprints"("project_id","number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_changes_project_idx" ON "requirement_changes" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE POLICY "requirement_changes_select_member" ON "requirement_changes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("requirement_changes"."workspace_id"));--> statement-breakpoint
CREATE POLICY "requirement_changes_insert_manager" ON "requirement_changes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("requirement_changes"."workspace_id", array['owner', 'admin', 'pm']) and "requirement_changes"."status" = 'DRAFT');--> statement-breakpoint
CREATE POLICY "requirement_changes_update_proposed" ON "requirement_changes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.has_role("requirement_changes"."workspace_id", array['owner', 'admin', 'pm']) and "requirement_changes"."status" = 'DRAFT') WITH CHECK (private.has_role("requirement_changes"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "impact_reviews_select_member" ON "impact_reviews" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("impact_reviews"."workspace_id"));--> statement-breakpoint
CREATE POLICY "impact_reviews_insert_manager" ON "impact_reviews" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("impact_reviews"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprint_settings_select_member" ON "sprint_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("sprint_settings"."workspace_id"));--> statement-breakpoint
CREATE POLICY "sprint_settings_insert_manager" ON "sprint_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("sprint_settings"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprint_settings_update_manager" ON "sprint_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.has_role("sprint_settings"."workspace_id", array['owner', 'admin', 'pm'])) WITH CHECK (private.has_role("sprint_settings"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprints_select_member" ON "sprints" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("sprints"."workspace_id"));--> statement-breakpoint
CREATE POLICY "sprints_insert_manager" ON "sprints" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("sprints"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprints_update_manager" ON "sprints" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.has_role("sprints"."workspace_id", array['owner', 'admin', 'pm'])) WITH CHECK (private.has_role("sprints"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprints_delete_manager" ON "sprints" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.has_role("sprints"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprint_items_select_member" ON "sprint_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("sprint_items"."workspace_id"));--> statement-breakpoint
CREATE POLICY "sprint_items_insert_manager" ON "sprint_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("sprint_items"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprint_items_update_manager" ON "sprint_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.has_role("sprint_items"."workspace_id", array['owner', 'admin', 'pm'])) WITH CHECK (private.has_role("sprint_items"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "sprint_items_delete_manager" ON "sprint_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.has_role("sprint_items"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
REVOKE DELETE ON TABLE "public"."sprint_settings", "public"."requirement_changes" FROM "authenticated";--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "public"."impact_reviews" FROM "authenticated";
