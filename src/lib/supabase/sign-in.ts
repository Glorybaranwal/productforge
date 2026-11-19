/**
 * Sign-in flows (PF-013, ADR-021): email magic links and OAuth (GitHub), both finished by
 * `/auth/callback`. Route handlers and server actions stay thin and call these.
 */
import { z } from "zod";

import { safeNext } from "@/src/lib/auth-gate";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { logger } from "@/src/lib/logger";

import { appUrl, authDriver, type OAuthProvider, oauthProviders } from "./config";
import { createSupabaseServerClient } from "./server";

export const MagicLinkInput = z.object({
  email: z.email("Enter a valid email address").max(254),
  next: z.string().max(2000).optional(),
});

const callbackUrl = (next?: string | null) =>
  `${appUrl()}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

type AuthApiError = { status?: number; code?: string; message: string } | null;

/** Turns a Supabase Auth error into a message safe to show; the details go to the log. */
function signInError(error: AuthApiError): AppError {
  logger.warn("Sign-in request failed", { code: error?.code, status: error?.status });
  const code = error?.code ?? "";
  if (error?.status === 429 || code.startsWith("over_")) {
    return new AppError("RATE_LIMITED", "Too many sign-in attempts. Wait a minute and try again.");
  }
  if (code === "email_address_not_authorized") {
    // Supabase's built-in email only reaches the project's team until custom SMTP is set up.
    return new AppError("FORBIDDEN", "We can't send sign-in emails to this address yet.");
  }
  if (code === "signup_disabled" || code === "otp_disabled" || code === "provider_disabled") {
    return new AppError("FORBIDDEN", "This sign-in method is turned off.");
  }
  return new AppError("INTERNAL", "We couldn't start sign-in. Please try again.");
}

/** Emails a one-time sign-in link. Supabase creates the account the first time. */
export async function requestMagicLink(input: unknown): Promise<void> {
  const { email, next } = parseOrThrow(MagicLinkInput, input);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(next), shouldCreateUser: true },
  });
  if (error) throw signInError(error);
}

/** The provider's consent page to send the browser to. */
export async function startOAuth(provider: OAuthProvider, next?: string | null): Promise<string> {
  if (!oauthProviders().includes(provider)) {
    throw new AppError("FORBIDDEN", "This sign-in method is turned off.");
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(next), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw signInError(error);
  return data.url;
}

export type SignInFailure = "link_invalid" | "provider_denied" | "missing_code";
export type SignInResult = { ok: true; next: string } | { ok: false; reason: SignInFailure };

/**
 * Finishes a sign-in from the callback URL: `code` (OAuth, and magic links with Supabase's default
 * email template) or `token_hash` + `type` (an email template that links straight here).
 */
export async function completeSignIn(params: URLSearchParams): Promise<SignInResult> {
  const next = safeNext(params.get("next"));
  if (authDriver() === "demo") return { ok: true, next };
  if (params.get("error")) return { ok: false, reason: "provider_denied" };

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!code && !(tokenHash && (type === "email" || type === "magiclink"))) {
    return { ok: false, reason: "missing_code" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: type as "email" | "magiclink",
      });
  if (error) {
    logger.warn("Sign-in link rejected", { code: error.code, status: error.status });
    return { ok: false, reason: "link_invalid" };
  }
  return { ok: true, next };
}

/** Ends the session on this device only (other devices stay signed in). */
export async function signOut(): Promise<void> {
  if (authDriver() === "demo") return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) logger.warn("Sign-out failed", { code: error.code, status: error.status });
}
