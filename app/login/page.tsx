import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/src/lib/auth-gate";
import { authDriver, oauthProviders } from "@/src/lib/supabase/config";

export const metadata: Metadata = { title: "Sign in" };

/** Only known codes are shown, so the page never echoes text from the URL. */
const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid:
    "That sign-in link has expired or was already used. Request a new one and open it in this browser.",
  provider_denied: "Sign-in was cancelled. Try again when you're ready.",
  missing_code: "That sign-in link is incomplete. Request a new one.",
};

type LoginPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  // Demo mode (ADR-011) has no sign-in.
  if (authDriver() === "demo") redirect(next);
  const error = typeof params.error === "string" ? CALLBACK_ERRORS[params.error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-16">
      <LoginForm next={next} error={error} github={oauthProviders().includes("github")} />
    </main>
  );
}
