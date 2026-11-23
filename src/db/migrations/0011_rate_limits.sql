-- PF-084: HTTP rate limits. Hand-written (drizzle-kit could not run); the hand edits are the grants at
-- the end. The table is written only through adminDb(), so `authenticated` and `anon` get nothing, and
-- RLS is on with no policies so that even an accidental future grant denies by default.
CREATE TABLE "rate_limit_hits" (
	"principal" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY("principal","bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limit_hits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rate_limit_hits_window_start_idx" ON "rate_limit_hits" USING btree ("window_start");--> statement-breakpoint
REVOKE ALL ON TABLE "public"."rate_limit_hits" FROM "authenticated", "anon";
