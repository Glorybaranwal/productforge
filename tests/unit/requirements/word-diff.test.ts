import { describe, expect, it } from "vitest";

import { diffWords } from "@/src/modules/requirements/word-diff";

describe("diffWords", () => {
  it("reports identical wording as one unchanged part", () => {
    expect(diffWords("Reports can be exported", "Reports  can be\nexported")).toEqual([
      { kind: "same", text: "Reports can be exported" },
    ]);
  });

  it("marks replaced words as removed on the left and added on the right", () => {
    expect(
      diffWords("Reports download as CSV files", "Reports download as PDF and Excel files"),
    ).toEqual([
      { kind: "same", text: "Reports download as" },
      { kind: "added", text: "PDF and Excel" },
      { kind: "removed", text: "CSV" },
      { kind: "same", text: "files" },
    ]);
  });

  it("keeps the left side and the right side readable on their own", () => {
    const before = "Admins can export an audit log";
    const after = "Admins and auditors can export a full audit log daily";
    const parts = diffWords(before, after);
    const side = (hide: string) =>
      parts
        .filter((p) => p.kind !== hide)
        .map((p) => p.text)
        .join(" ");
    expect(side("added")).toBe(before);
    expect(side("removed")).toBe(after);
  });

  it("handles empty wording on either side", () => {
    expect(diffWords("", "New text")).toEqual([{ kind: "added", text: "New text" }]);
    expect(diffWords("Old text", "")).toEqual([{ kind: "removed", text: "Old text" }]);
    expect(diffWords("", "")).toEqual([]);
  });
});
