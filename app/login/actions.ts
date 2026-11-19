"use server";

import { redirect } from "next/navigation";

import { AppError } from "@/src/lib/errors";
import { requestMagicLink, startOAuth } from "@/src/lib/supabase/sign-in";

export type MagicLinkState = {
  status: "idle" | "sent" | "error";
  email?: string;
  message?: string;
};

/** Emails a sign-in link (PF-013). Expected failures come back as a message for the form. */
export async function sendMagicLink(
  _prev: MagicLinkState,
  form: FormData,
): Promise<MagicLinkState> {
  const email = String(form.get("email") ?? "").trim();
  try {
    await requestMagicLink({ email, next: form.get("next")?.toString() || undefined });
    return { status: "sent", email };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const message = err.code === "VALIDATION_ERROR" ? "Enter a valid email address." : err.message;
    return { status: "error", email, message };
  }
}

/** Sends the browser to GitHub's consent page (PF-013). */
export async function signInWithGitHub(form: FormData): Promise<void> {
  const url = await startOAuth("github", form.get("next")?.toString());
  redirect(url);
}
