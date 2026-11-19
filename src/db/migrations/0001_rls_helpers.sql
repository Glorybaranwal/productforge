-- PF-012 / ADR-020: membership checks for the RLS policies (custom migration).
-- A policy on workspace_members that queries workspace_members — directly, or through the
-- workspaces policy — makes Postgres fail with "infinite recursion detected in policy". These
-- functions run as their owner (the table owner, which RLS doesn't apply to), so the policies call
-- them instead of querying the tables. They live in "private", which Supabase's Data API doesn't
-- expose, run with an empty search_path and use fully qualified names.
CREATE SCHEMA IF NOT EXISTS "private";--> statement-breakpoint
REVOKE ALL ON SCHEMA "private" FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA "private" TO "authenticated";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "private"."is_member"(ws uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "private"."has_role"(ws uuid, roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role::text = any (roles)
  )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "private"."workspace_owner"(ws uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  select w.owner_id from public.workspaces w where w.id = ws
$$;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "private" FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "private" TO "authenticated";
