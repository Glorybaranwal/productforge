-- PF-073 / ADR-029: the backlog in Postgres. Hand edit: the grant at the end (epics and stories are never deleted).
CREATE TYPE "public"."story_priority" AS ENUM('must', 'should', 'could');--> statement-breakpoint
CREATE TYPE "public"."criterion_kind" AS ENUM('positive', 'negative', 'edge');--> statement-breakpoint
CREATE TABLE "epics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "artifact_status" NOT NULL,
	"evidence" "evidence_label" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" varchar(12) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "epics_id_workspace_id_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "epics_project_code_key" UNIQUE("project_id","code"),
	CONSTRAINT "epics_code_format" CHECK ("epics"."code" ~ '^EP-[0-9]{2,}$')
);
--> statement-breakpoint
ALTER TABLE "epics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "artifact_status" NOT NULL,
	"evidence" "evidence_label" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"epic_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"version" integer NOT NULL,
	"based_on_version" integer,
	"title" varchar(120) NOT NULL,
	"as_a" varchar(80) NOT NULL,
	"i_want" varchar(300) NOT NULL,
	"so_that" varchar(300) NOT NULL,
	"priority" "story_priority" NOT NULL,
	"story_points" integer,
	"requirement_codes" text[] NOT NULL,
	"depends_on" text[] NOT NULL,
	"rationale" text,
	"rejection_reason" text,
	"prd_version" integer,
	"created_by" uuid,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "stories_id_workspace_id_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "stories_project_code_version_key" UNIQUE("project_id","code","version"),
	CONSTRAINT "stories_code_format" CHECK ("stories"."code" ~ '^US-[0-9]{3,}$'),
	CONSTRAINT "stories_version_positive" CHECK ("stories"."version" > 0),
	CONSTRAINT "stories_points" CHECK ("stories"."story_points" is null or "stories"."story_points" in (1, 2, 3, 5, 8, 13)),
	CONSTRAINT "stories_requirements_linked" CHECK (cardinality("stories"."requirement_codes") >= 1)
);
--> statement-breakpoint
ALTER TABLE "stories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "acceptance_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "artifact_status" NOT NULL,
	"evidence" "evidence_label" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"story_id" uuid NOT NULL,
	"kind" "criterion_kind" NOT NULL,
	"given" varchar(400) NOT NULL,
	"when" varchar(400) NOT NULL,
	"then" varchar(400) NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "technical_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "artifact_status" NOT NULL,
	"evidence" "evidence_label" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"story_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(500) NOT NULL,
	"estimate_hours" numeric(4, 1) NOT NULL,
	"position" integer NOT NULL,
	"sprint_id" uuid,
	CONSTRAINT "technical_tasks_code_format" CHECK ("technical_tasks"."code" ~ '^TASK-[0-9]{3,}$'),
	CONSTRAINT "technical_tasks_hours" CHECK ("technical_tasks"."estimate_hours" between 0.5 and 40)
);
--> statement-breakpoint
ALTER TABLE "technical_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "epics" ADD CONSTRAINT "epics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epics" ADD CONSTRAINT "epics_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epics" ADD CONSTRAINT "epics_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_epic_fk" FOREIGN KEY ("epic_id","workspace_id") REFERENCES "public"."epics"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_story_fk" FOREIGN KEY ("story_id","workspace_id") REFERENCES "public"."stories"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_tasks" ADD CONSTRAINT "technical_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_tasks" ADD CONSTRAINT "technical_tasks_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_tasks" ADD CONSTRAINT "technical_tasks_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_tasks" ADD CONSTRAINT "technical_tasks_story_fk" FOREIGN KEY ("story_id","workspace_id") REFERENCES "public"."stories"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epics_project_idx" ON "epics" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "stories_project_idx" ON "stories" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "stories_requirement_codes_idx" ON "stories" USING gin ("requirement_codes");--> statement-breakpoint
CREATE INDEX "acceptance_criteria_project_idx" ON "acceptance_criteria" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "acceptance_criteria_story_idx" ON "acceptance_criteria" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "technical_tasks_project_idx" ON "technical_tasks" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "technical_tasks_story_idx" ON "technical_tasks" USING btree ("story_id");--> statement-breakpoint
CREATE POLICY "epics_select_member" ON "epics" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("epics"."workspace_id"));--> statement-breakpoint
CREATE POLICY "epics_insert_manager" ON "epics" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("epics"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "epics_update_member" ON "epics" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("epics"."workspace_id")) WITH CHECK (private.is_member("epics"."workspace_id"));--> statement-breakpoint
CREATE POLICY "stories_select_member" ON "stories" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("stories"."workspace_id"));--> statement-breakpoint
CREATE POLICY "stories_insert_manager" ON "stories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("stories"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "stories_update_unapproved" ON "stories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("stories"."workspace_id") and ("stories"."status" = 'DRAFT' or private.has_role("stories"."workspace_id", array['owner', 'admin', 'pm'])) and "stories"."status" <> 'APPROVED') WITH CHECK (private.is_member("stories"."workspace_id") and ("stories"."status" = 'DRAFT' or private.has_role("stories"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "acceptance_criteria_select_member" ON "acceptance_criteria" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("acceptance_criteria"."workspace_id"));--> statement-breakpoint
CREATE POLICY "acceptance_criteria_insert_unapproved" ON "acceptance_criteria" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("acceptance_criteria"."workspace_id") and ("acceptance_criteria"."status" = 'DRAFT' or private.has_role("acceptance_criteria"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "acceptance_criteria_update_unapproved" ON "acceptance_criteria" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("acceptance_criteria"."workspace_id") and ("acceptance_criteria"."status" = 'DRAFT' or private.has_role("acceptance_criteria"."workspace_id", array['owner', 'admin', 'pm'])) and "acceptance_criteria"."status" <> 'APPROVED') WITH CHECK (private.is_member("acceptance_criteria"."workspace_id") and ("acceptance_criteria"."status" = 'DRAFT' or private.has_role("acceptance_criteria"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "acceptance_criteria_delete_unapproved" ON "acceptance_criteria" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.is_member("acceptance_criteria"."workspace_id") and ("acceptance_criteria"."status" = 'DRAFT' or (private.has_role("acceptance_criteria"."workspace_id", array['owner', 'admin', 'pm']) and "acceptance_criteria"."status" <> 'APPROVED')));--> statement-breakpoint
CREATE POLICY "technical_tasks_select_member" ON "technical_tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("technical_tasks"."workspace_id"));--> statement-breakpoint
CREATE POLICY "technical_tasks_insert_unapproved" ON "technical_tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("technical_tasks"."workspace_id") and ("technical_tasks"."status" = 'DRAFT' or private.has_role("technical_tasks"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "technical_tasks_update_unapproved" ON "technical_tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("technical_tasks"."workspace_id") and ("technical_tasks"."status" = 'DRAFT' or private.has_role("technical_tasks"."workspace_id", array['owner', 'admin', 'pm'])) and "technical_tasks"."status" <> 'APPROVED') WITH CHECK (private.is_member("technical_tasks"."workspace_id") and ("technical_tasks"."status" = 'DRAFT' or private.has_role("technical_tasks"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "technical_tasks_delete_unapproved" ON "technical_tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.is_member("technical_tasks"."workspace_id") and ("technical_tasks"."status" = 'DRAFT' or (private.has_role("technical_tasks"."workspace_id", array['owner', 'admin', 'pm']) and "technical_tasks"."status" <> 'APPROVED')));--> statement-breakpoint
REVOKE DELETE ON TABLE "public"."epics", "public"."stories" FROM "authenticated";
