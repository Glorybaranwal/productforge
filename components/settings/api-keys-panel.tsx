"use client";

import { useState } from "react";

import type { ApiKey } from "@/src/modules/api-keys/schema";

import { ApiKeyCreateForm, type CreatedKey } from "./api-key-create-form";
import { ApiKeyList } from "./api-key-list";
import { ApiKeySecret } from "./api-key-secret";

type Props = {
  initialKeys: ApiKey[];
  currentUserId: string;
  /** Owners and admins: the list holds every member's keys, not just the caller's. */
  seesWorkspaceKeys: boolean;
};

export function ApiKeysPanel({ initialKeys, currentUserId, seesWorkspaceKeys }: Props) {
  const [keys, setKeys] = useState(initialKeys);
  // The plaintext lives here and nowhere else: component state, never storage, a cookie or the URL.
  // The list is refetched into `keys`, which never carries it, so a refetch can't bring it back.
  const [issued, setIssued] = useState<{ name: string; plaintext: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch("/api/workspace/api-keys", { cache: "no-store" });
      if (res.ok) setKeys(((await res.json()) as { keys: ApiKey[] }).keys);
    } catch {
      /* keep showing the list we have */
    }
  }

  async function created({ key, plaintext }: CreatedKey) {
    setIssued({ name: key.name, plaintext });
    await reload();
  }

  async function revoke(key: ApiKey) {
    setRevokingId(key.id);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/api-keys/${key.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Couldn't revoke the key. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setRevokingId(null);
      await reload();
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          For scripts and services — a Jira sync, a CI smoke test — that need to call ProductForge
          without a browser.
          {seesWorkspaceKeys
            ? " As an owner or admin you also see the keys other members created."
            : " You see only the keys you created."}
        </p>
      </div>

      {issued && (
        <ApiKeySecret
          name={issued.name}
          plaintext={issued.plaintext}
          onDismiss={() => setIssued(null)}
        />
      )}
      <ApiKeyCreateForm
        onCreated={(c) => {
          void created(c);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {keys.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No API keys yet.</p>
          <p>
            A key lets a script or service call the ProductForge API. <b>It acts as you</b> — with
            your workspace, your role and no more than your permissions — so anything it does is
            recorded as done by you, and if your access is reduced or removed, so is the key&apos;s.
            Keys can never approve anything.
          </p>
        </div>
      ) : (
        <section aria-label="API keys" className="space-y-2">
          <h2 className="font-semibold">
            {seesWorkspaceKeys ? "Keys in this workspace" : "Your keys"}
          </h2>
          <ApiKeyList
            keys={keys}
            currentUserId={currentUserId}
            revokingId={revokingId}
            onRevoke={(k) => void revoke(k)}
          />
        </section>
      )}
    </div>
  );
}
