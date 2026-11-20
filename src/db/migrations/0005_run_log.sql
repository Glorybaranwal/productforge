-- PF-071 / ADR-027: the AI run log and idempotency records in Postgres.
-- Hand edits: (1) the three agent_run_id foreign keys are NOT VALID: rows written before this
-- migration point at runs kept in the demo store; new rows are checked, old ones are validated
-- in PF-075. (2) Grants at the end: the run log can't be deleted and idempotency records can't
-- be changed or deleted by signed-in users (no policy allows it either).
CREATE TYPE "public"."agent_stage" AS ENUM('discovery', 'prd', 'story', 'qa', 'task', 'impact');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage" "agent_stage" NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model" varchar(100) NOT NULL,
	"prompt_version" varchar(100) NOT NULL,
	"status" "run_status" NOT NULL,
	"attempts" integer NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"error" text,
	"events" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runs_id_workspace_id_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"workspace_id" uuid NOT NULL,
	"operation" varchar(120) NOT NULL,
	"key" varchar(200) NOT NULL,
	"result_id" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_pkey" PRIMARY KEY("workspace_id","operation","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_running" ON "agent_runs" USING btree ("workspace_id","project_id","stage") WHERE "agent_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "agent_runs_latest_idx" ON "agent_runs" USING btree ("workspace_id","project_id","stage","created_at");--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "clarifying_questions" ADD CONSTRAINT "clarifying_questions_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_agent_run_fk" FOREIGN KEY ("agent_run_id","workspace_id") REFERENCES "public"."agent_runs"("id","workspace_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE POLICY "agent_runs_select_member" ON "agent_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("agent_runs"."workspace_id"));--> statement-breakpoint
CREATE POLICY "agent_runs_insert_self" ON "agent_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("agent_runs"."workspace_id") and "agent_runs"."created_by" = (select auth.uid()) and "agent_runs"."status" = 'running');--> statement-breakpoint
CREATE POLICY "agent_runs_finish" ON "agent_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (private.is_member("agent_runs"."workspace_id") and "agent_runs"."status" = 'running' and ("agent_runs"."created_by" = (select auth.uid()) or "agent_runs"."created_at" < now() - interval '10 minutes')) WITH CHECK (private.is_member("agent_runs"."workspace_id"));--> statement-breakpoint
CREATE POLICY "idempotency_records_select_member" ON "idempotency_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_member("idempotency_records"."workspace_id"));--> statement-breakpoint
CREATE POLICY "idempotency_records_insert_self" ON "idempotency_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (private.is_member("idempotency_records"."workspace_id") and "idempotency_records"."created_by" = (select auth.uid()));--> statement-breakpoint
REVOKE DELETE ON TABLE "public"."agent_runs" FROM "authenticated";--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "public"."idempotency_records" FROM "authenticated";