// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunProgressNote } from "@/components/runs/run-progress-note";
import { useRunProgress } from "@/components/runs/use-run-progress";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  listeners = new Map<string, ((e: Event) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    for (const fn of this.listeners.get(type) ?? [])
      fn(type === "error" ? new Event("error") : new MessageEvent(type, { data }));
  }
}

const frame = (message: string) => JSON.stringify({ runId: "r1", stage: "discovery", message });

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useRunProgress (PF-027)", () => {
  it("opens the stream on start with the project and stages", () => {
    const { result } = renderHook(() => useRunProgress("p1", ["story", "qa"]));
    expect(FakeEventSource.instances).toHaveLength(0);
    act(() => result.current.start());
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/projects/p1/runs/live?stages=story,qa");
  });

  it("shows the latest step and clears it on stop, closing the stream", () => {
    const { result } = renderHook(() => useRunProgress("p1", ["discovery"]));
    act(() => result.current.start());
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit("progress", frame("Reading sources")));
    expect(result.current.message).toBe("Reading sources");
    act(() => source.emit("progress", frame("Asking the model")));
    expect(result.current.message).toBe("Asking the model");

    act(() => result.current.stop());
    expect(source.closed).toBe(true);
    expect(result.current.message).toBeNull();
  });

  it("closes the stream when the component unmounts", () => {
    const { result, unmount } = renderHook(() => useRunProgress("p1", ["discovery"]));
    act(() => result.current.start());
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });

  it("closes the first stream when start is called again", () => {
    const { result } = renderHook(() => useRunProgress("p1", ["discovery"]));
    act(() => result.current.start());
    act(() => result.current.start());
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(FakeEventSource.instances[1]!.closed).toBe(false);
  });

  it("ignores a malformed frame and keeps the last message", () => {
    const { result } = renderHook(() => useRunProgress("p1", ["discovery"]));
    act(() => result.current.start());
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit("progress", frame("Reading sources")));
    expect(() => act(() => source.emit("progress", "{not json"))).not.toThrow();
    expect(result.current.message).toBe("Reading sources");
  });

  it("closes the stream when it fails", () => {
    const { result } = renderHook(() => useRunProgress("p1", ["discovery"]));
    act(() => result.current.start());
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit("error"));
    expect(source.closed).toBe(true);
  });
});

describe("RunProgressNote", () => {
  it("renders a persistent, empty status region when idle", () => {
    render(<RunProgressNote busy={false} message={null} />);
    const note = screen.getByRole("status");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent("");
  });

  it("keeps the same element and changes only its text while running", () => {
    const { rerender } = render(<RunProgressNote busy={false} message={null} />);
    const before = screen.getByRole("status");
    rerender(<RunProgressNote busy message="Asking the model" />);
    const during = screen.getByRole("status");
    expect(during).toBe(before);
    expect(during).toHaveTextContent("Asking the model");
    rerender(<RunProgressNote busy={false} message="Asking the model" />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
