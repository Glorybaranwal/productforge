-- PF-070 / ADR-026: discovery data. The (id, workspace_id) key on projects must exist before the
-- composite foreign keys below reference it (drizzle-kit emits it last; moved here by hand).
ALTER TABLE "projects" ADD CONSTRAINT "projects_id_workspace_id_key" UNIQUE("id","workspace_id");--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('functional', 'non_functional');--> statement-breakpoint
CREATE TYPE "public"."evidence_label" AS ENUM('EXPLICIT', 'INFERRED', 'ASSUMPTION', 'OPEN_QUESTION');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."artifact_origin" AS ENUM('ai', 'human', 'ai_edited');--> statement-breakpoint
CREATE TYPE "public"."question_state" AS ENUM('open', 'answered', 'skipped', 'assumption');--> statement-breakpoint
CREATE TYPE "public"."discovery_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('paste', 'file');--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"type" "requirement_type" NOT NULL,
	"evidence" "evidence_label" NOT NULL,
	"source_quote" text,
	"rationale" text,
	"source_id" text,
	"status" "artifact_status" NOT NULL,
	"origin" "artifact_origin" NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "requirements_project_code_version_key" UNIQUE("project_id","code","version"),
	CONSTRAINT "requirements_code_format" CHECK ("requirements"."code" ~ '^N?FR-[0-9]{2,}$'),
	CONSTRAINT "requirements_version_positive" CHECK ("requirements"."version" > 0),
	CONSTRAINT "requirements_text_length" CHECK (length("requirements"."text") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clarifying_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question" text NOT NULL,
	"reason" text NOT NULL,
	"state" "question_state" NOT NULL,
	"answer" text,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clarifying_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discoveries" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"run_count" integer NOT NULL,
	"summary" text NOT NULL,
	"actors" jsonb NOT NULL,
	"goals" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"conflicts" jsonb NOT NULL,
	"ambiguities" jsonb NOT NULL,
	"status" "discovery_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "discoveries_run_count_positive" CHECK ("discoveries"."run_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "discoveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "source_kind" NOT NULL,
	"text" text NOT NULL,
	"char_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_documents_text_length" CHECK (length("source_documents"."text") <= 50000 and "source_documents"."char_count" = length("source_documents"."text"))
);
--> statement-breakpoint
ALTER TABLE "source_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifying_questions" ADD CONSTRAINT "clarifying_questions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifying_questions" ADD CONSTRAINT "clarifying_questions_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirements_project_idx" ON "requirements" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "clarifying_questions_project_idx" ON "clarifying_questions" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "source_documents_project_idx" ON "source_documents" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE POLICY "requirements_select_member" ON "requirements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("requirements"."workspace_id"));--> statement-breakpoint
CREATE POLICY "requirements_insert_member" ON "requirements" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("requirements"."workspace_id") and ("requirements"."status" <> 'APPROVED' or private.has_role("requirements"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "requirements_update_draft" ON "requirements" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("requirements"."workspace_id") and "requirements"."status" <> 'APPROVED') WITH CHECK (private.is_member("requirements"."workspace_id") and ("requirements"."status" <> 'APPROVED' or private.has_role("requirements"."workspace_id", array['owner', 'admin', 'pm'])));--> statement-breakpoint
CREATE POLICY "requirements_delete_ai_draft" ON "requirements" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.has_role("requirements"."workspace_id", array['owner', 'admin', 'pm']) and "requirements"."status" = 'DRAFT' and "requirements"."origin" = 'ai');--> statement-breakpoint
CREATE POLICY "clarifying_questions_select_member" ON "clarifying_questions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("clarifying_questions"."workspace_id"));--> statement-breakpoint
CREATE POLICY "clarifying_questions_insert_manager" ON "clarifying_questions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("clarifying_questions"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "clarifying_questions_update_member" ON "clarifying_questions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("clarifying_questions"."workspace_id")) WITH CHECK (private.is_member("clarifying_questions"."workspace_id"));--> statement-breakpoint
CREATE POLICY "clarifying_questions_delete_open" ON "clarifying_questions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.has_role("clarifying_questions"."workspace_id", array['owner', 'admin', 'pm']) and "clarifying_questions"."state" = 'open');--> statement-breakpoint
CREATE POLICY "discoveries_select_member" ON "discoveries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("discoveries"."workspace_id"));--> statement-breakpoint
CREATE POLICY "discoveries_insert_manager" ON "discoveries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.has_role("discoveries"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "discoveries_update_manager" ON "discoveries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.has_role("discoveries"."workspace_id", array['owner', 'admin', 'pm'])) WITH CHECK (private.has_role("discoveries"."workspace_id", array['owner', 'admin', 'pm']));--> statement-breakpoint
CREATE POLICY "source_documents_select_member" ON "source_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("source_documents"."workspace_id"));--> statement-breakpoint
CREATE POLICY "source_documents_insert_self" ON "source_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("source_documents"."workspace_id") and "source_documents"."created_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "source_documents_delete_member" ON "source_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (private.is_member("source_documents"."workspace_id"));