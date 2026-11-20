-- PF-075 / ADR-031: every agent_run_id link checked. Rows written before PF-071 point at runs that stayed in
-- the demo store: their link is cleared (the row is kept), then the foreign keys added NOT VALID in 0005 are validated.
ALTER TABLE "discoveries" ALTER COLUMN "agent_run_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "public"."requirements" AS r SET "agent_run_id" = NULL WHERE r."agent_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."agent_runs" AS a WHERE a."id" = r."agent_run_id" AND a."workspace_id" = r."workspace_id");--> statement-breakpoint
UPDATE "public"."clarifying_questions" AS r SET "agent_run_id" = NULL WHERE r."agent_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."agent_runs" AS a WHERE a."id" = r."agent_run_id" AND a."workspace_id" = r."workspace_id");--> statement-breakpoint
UPDATE "public"."discoveries" AS r SET "agent_run_id" = NULL WHERE r."agent_run_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."agent_runs" AS a WHERE a."id" = r."agent_run_id" AND a."workspace_id" = r."workspace_id");--> statement-breakpoint
ALTER TABLE "public"."requirements" VALIDATE CONSTRAINT "requirements_agent_run_fk";--> statement-breakpoint
ALTER TABLE "public"."clarifying_questions" VALIDATE CONSTRAINT "clarifying_questions_agent_run_fk";--> statement-breakpoint
ALTER TABLE "public"."discoveries" VALIDATE CONSTRAINT "discoveries_agent_run_fk";
