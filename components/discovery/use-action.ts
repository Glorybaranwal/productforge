"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type FieldErrors } from "@/src/lib/api-client";

/** Runs an API call, then refreshes the server data. Tracks busy state and the error to show. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await work();
      router.refresh();
      return result;
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Something went wrong. Please try again.");
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, error, fieldErrors, clearError: () => setError(null) };
}
