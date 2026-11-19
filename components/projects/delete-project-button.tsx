"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiRequest } from "@/src/lib/api-client";

/** Two-step delete: the first click asks for confirmation, the second deletes. */
export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/projects/${projectId}`, { method: "DELETE" });
      router.push("/dashboard");
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Couldn't delete the project.");
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Delete project
      </Button>
    );
  }

  return (
    <div role="group" aria-label="Confirm deletion" className="space-y-3">
      <p className="text-sm">
        Delete <strong>{projectName}</strong> and everything in it? This can&apos;t be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={onDelete} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete project"}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
