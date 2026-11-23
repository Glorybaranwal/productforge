"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * The one place a plaintext key is ever rendered. The parent holds it in component state only: it is
 * not written to storage, a cookie or the URL, and it is gone when this is dismissed, when another key
 * is created, or when the page is left.
 */
export function ApiKeySecret({
  name,
  plaintext,
  onDismiss,
}: {
  name: string;
  plaintext: string;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setNote("Copied.");
    } catch {
      setNote("The browser blocked copying — select the key and copy it.");
    }
  }

  return (
    <section
      aria-label="New API key"
      className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5"
    >
      <h2 className="font-semibold text-amber-950">Copy “{name}” now</h2>
      <p className="text-sm text-amber-900">
        <b>This key will not be shown again.</b> ProductForge keeps only a fingerprint of it, so it
        can&apos;t be recovered — if you lose it, revoke it and create a new one.
      </p>
      <code
        data-testid="api-key-plaintext"
        onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}
        className="block break-all rounded-md border bg-background p-3 font-mono text-xs"
      >
        {plaintext}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy}>Copy key</Button>
        <Button variant="outline" onClick={onDismiss}>
          I&apos;ve saved it
        </Button>
        {note && (
          <span role="status" className="text-sm text-amber-900">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}
