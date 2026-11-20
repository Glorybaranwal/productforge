"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RunProgress } from "@/src/ai/orchestrator/watch-runs";

/**
 * Live steps of a project's AI runs (PF-027): call `start()` just before starting a run and `stop()`
 * when its request returns. `message` is the latest step, for a line under the button.
 */
export function useRunProgress(projectId: string, stages: string[]) {
  const [message, setMessage] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const key = stages.join(",");

  const stop = useCallback(() => {
    source.current?.close();
    source.current = null;
    setMessage(null);
  }, []);

  const start = useCallback(() => {
    source.current?.close();
    const events = new EventSource(`/api/projects/${projectId}/runs/live?stages=${key}`);
    events.addEventListener("progress", (e) => {
      const step = JSON.parse((e as MessageEvent<string>).data) as RunProgress;
      setMessage(step.message);
    });
    source.current = events;
  }, [projectId, key]);

  useEffect(() => stop, [stop]);
  return { message, start, stop };
}
