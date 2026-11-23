"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_MAX_EXPIRY_DAYS,
  type ApiKey,
  type ApiKeyScope,
} from "@/src/modules/api-keys/schema";

const DAY_MS = 864e5;

export type CreatedKey = { key: ApiKey; plaintext: string };

/** A name, a scope and an optional lifetime. Calls the create endpoint and hands the result up. */
export function ApiKeyCreateForm({ onCreated }: { onCreated: (created: CreatedKey) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("read");
  const [days, setDays] = useState(String(API_KEY_DEFAULT_EXPIRY_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(days);
    if (days.trim() !== "" && (!Number.isInteger(n) || n < 1 || n > API_KEY_MAX_EXPIRY_DAYS)) {
      setError(`Enter a whole number of days from 1 to ${API_KEY_MAX_EXPIRY_DAYS}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No days given: leave expiresAt out and the server applies its 90-day default.
        body: JSON.stringify({
          name,
          scope,
          ...(days.trim() === ""
            ? {}
            : { expiresAt: new Date(Date.now() + n * DAY_MS).toISOString() }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; details?: { message: string }[] };
        } | null;
        setError(
          body?.error?.details?.[0]?.message ??
            body?.error?.message ??
            "Couldn't create the key. Try again.",
        );
        return;
      }
      onCreated((await res.json()) as CreatedKey);
      setName("");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Create an API key"
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <h2 className="font-semibold">Create a key</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            value={name}
            maxLength={80}
            placeholder="Jira sync"
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="key-scope">Scope</Label>
          <NativeSelect
            id="key-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ApiKeyScope)}
          >
            <option value="read">Read — can only read</option>
            <option value="write">Write — can also create and edit</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="key-days">Expires after (days)</Label>
          <Input
            id="key-days"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Keys last {API_KEY_DEFAULT_EXPIRY_DAYS} days unless you choose otherwise, and never more
        than {API_KEY_MAX_EXPIRY_DAYS}. No scope can approve anything — approving is always a
        person.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create key"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
