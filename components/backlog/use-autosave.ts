"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/src/lib/api-client";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 800;

/**
 * Debounced autosave for an editor section: `change(next)` keeps the draft locally and saves it
 * after a pause, once `check` accepts it. Server data refreshes after each save.
 */
export function useAutosave<T>(
  initial: T,
  check: (value: T) => { ok: true; value: unknown } | { ok: false; message: string },
  save: (value: unknown) => Promise<unknown>,
) {
  const router = useRouter();
  const [draft, setDraft] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<T>(initial);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function persist(next: T) {
    const result = check(next);
    if (!result.ok) {
      setStatus("error");
      setMessage(result.message);
      return;
    }
    setStatus("saving");
    try {
      await save(result.value);
      if (latest.current === next) setStatus("saved");
      setMessage(null);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Couldn't save. Your text is still here — try again.",
      );
    }
  }

  function change(next: T) {
    setDraft(next);
    latest.current = next;
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next), AUTOSAVE_MS);
  }

  return { draft, change, status, message };
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
};

export function saveStatusText(status: SaveStatus): string {
  return STATUS_TEXT[status];
}
