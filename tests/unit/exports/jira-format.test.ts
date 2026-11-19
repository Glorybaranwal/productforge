import { describe, expect, it } from "vitest";

import { jiraDuration, toAdf } from "@/src/modules/exports/jira-json";
import { descriptionText, JIRA_PRIORITY } from "@/src/modules/exports/plan";
import { parseCsv } from "@/tests/helpers/jira-csv-check";

describe("Jira export formatting", () => {
  const blocks = [
    { kind: "p" as const, text: "As a customer, I want X so that Y." },
    { kind: "h" as const, text: "Acceptance criteria" },
    {
      kind: "ol" as const,
      items: ["Positive: Given a, when b, then c.", "Edge case: Given d, when e, then f."],
    },
    { kind: "ul" as const, items: ["FR-01: text"] },
  ];

  it("renders descriptions as plain text and as Atlassian Document Format", () => {
    expect(descriptionText(blocks)).toBe(
      "As a customer, I want X so that Y.\n\nAcceptance criteria\n\n1. Positive: Given a, when b, then c.\n2. Edge case: Given d, when e, then f.\n\n- FR-01: text",
    );
    const adf = toAdf(blocks);
    expect(adf.type).toBe("doc");
    expect(adf.content!.map((n) => n.type)).toEqual([
      "paragraph",
      "heading",
      "orderedList",
      "bulletList",
    ]);
    expect(adf.content![2]!.content![1]!.content![0]!.content![0]!.text).toBe(
      "Edge case: Given d, when e, then f.",
    );
  });

  it("formats durations and priorities the way Jira expects", () => {
    expect([jiraDuration(6), jiraDuration(1.5), jiraDuration(0.5)]).toEqual([
      "6h",
      "1h 30m",
      "30m",
    ]);
    expect(JIRA_PRIORITY).toEqual({ must: "High", should: "Medium", could: "Low" });
  });

  it("the CSV checker's parser handles quotes, commas and line breaks", () => {
    expect(parseCsv('a,"b, ""c""",d\r\n"multi\nline",2,\r\n')).toEqual([
      ["a", 'b, "c"', "d"],
      ["multi\nline", "2", ""],
    ]);
    expect(() => parseCsv('a,"b"x\r\n')).toThrow();
    expect(() => parseCsv('"open')).toThrow();
  });
});
