"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/src/lib/format";
import type { ApiKey } from "@/src/modules/api-keys/schema";

import { apiKeyStatus } from "./api-key-status";

type Props = {
  keys: ApiKey[];
  currentUserId: string;
  revokingId: string | null;
  onRevoke: (key: ApiKey) => void;
};

/** There is no member directory to resolve a name from, so another member's key shows a short id. */
export function ownerLabel(key: ApiKey, currentUserId: string): string {
  return key.userId === currentUserId ? "Yours" : `Member ${key.userId.slice(0, 8)}`;
}

export function ApiKeyList({ keys, currentUserId, revokingId, onRevoke }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {keys.map((key) => {
        const status = apiKeyStatus(key);
        const mine = key.userId === currentUserId;
        const dead = status !== "active";
        return (
          <li
            key={key.id}
            data-status={status}
            className={`space-y-2 p-4 text-sm ${mine ? "" : "bg-sky-50"} ${dead ? "opacity-70" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-medium ${status === "revoked" ? "line-through" : ""}`}>
                {key.name}
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{key.prefix}</code>
              <Badge variant="outline">{key.scope === "write" ? "Write" : "Read"}</Badge>
              {status === "revoked" && <Badge variant="destructive">Revoked</Badge>}
              {status === "expired" && (
                <Badge className="border-transparent bg-amber-100 text-amber-900">Expired</Badge>
              )}
              {!mine && (
                <Badge className="border-transparent bg-sky-100 text-sky-900">
                  Another member&apos;s key — {ownerLabel(key, currentUserId)}
                </Badge>
              )}
              {status === "active" && confirming !== key.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={revokingId === key.id}
                  onClick={() => setConfirming(key.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">
              Created {formatDate(key.createdAt)} ·{" "}
              {key.lastUsedAt ? `Last used ${formatDateTime(key.lastUsedAt)}` : "Never used"} ·{" "}
              {status === "revoked" && key.revokedAt
                ? `Revoked ${formatDate(key.revokedAt)}`
                : status === "expired"
                  ? `Expired ${formatDate(key.expiresAt)}`
                  : `Expires ${formatDate(key.expiresAt)}`}
            </p>
            {confirming === key.id && status === "active" && (
              <div
                role="alertdialog"
                aria-label={`Revoke ${key.name}`}
                className="space-y-2 rounded-lg border border-destructive/40 bg-background p-3"
              >
                <p>
                  Revoke <b>{key.name}</b>
                  {mine ? "" : ` (${ownerLabel(key, currentUserId)}'s key)`}? It stops working{" "}
                  <b>immediately</b>, and a revoked key can never be turned back on.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokingId === key.id}
                    onClick={() => {
                      setConfirming(null);
                      onRevoke(key);
                    }}
                  >
                    Revoke key
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
