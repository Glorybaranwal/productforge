"use client";

import { useActionState } from "react";

import { type MagicLinkState, sendMagicLink, signInWithGitHub } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginFormProps = { next: string; error?: string; github: boolean };

const IDLE: MagicLinkState = { status: "idle" };

/** Email magic link, plus GitHub when it's enabled (PF-013). */
export function LoginForm({ next, error, github }: LoginFormProps) {
  const [state, sendLink, sending] = useActionState(sendMagicLink, IDLE);
  const failed = state.status === "error";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <h1 className="text-lg leading-none font-semibold">Sign in to ProductForge AI</h1>
        <CardDescription>We&apos;ll email you a one-time link. No password needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {state.status === "sent" ? (
          <p role="status" className="text-sm">
            Check <span className="font-medium">{state.email}</span> for your sign-in link. Open it
            in this browser.
          </p>
        ) : (
          <form action={sendLink} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={state.email}
                aria-invalid={failed || undefined}
                aria-describedby={failed ? "email-error" : undefined}
              />
              {failed && (
                <p id="email-error" role="alert" className="text-sm text-destructive">
                  {state.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </form>
        )}
        {github && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <form action={signInWithGitHub}>
              <input type="hidden" name="next" value={next} />
              <Button type="submit" variant="outline" className="w-full">
                Continue with GitHub
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
