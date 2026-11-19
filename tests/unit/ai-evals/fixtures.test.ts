import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_TARGETS,
  EvalFixture,
  FIXTURE_CATEGORIES,
  FIXTURE_FILENAME,
  QUICK_SET_SIZE,
} from "@/tests/ai-evals/fixture-schema";

const FIXTURES_DIR = fileURLToPath(new URL("../../ai-evals/fixtures/", import.meta.url));

const files = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

const fixtures = files.map((file) => ({
  file,
  raw: JSON.parse(readFileSync(`${FIXTURES_DIR}${file}`, "utf8")) as unknown,
}));

const parsed = fixtures.map(({ file, raw }) => ({ file, result: EvalFixture.safeParse(raw) }));
const valid = parsed.flatMap(({ file, result }) =>
  result.success ? [{ file, ...result.data }] : [],
);

describe("AI eval fixtures", () => {
  it.each(parsed)("$file matches the fixture format", ({ result }) => {
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each(files)("%s is named NNN-<slug>.json with NNN equal to its id", (file) => {
    const match = FIXTURE_FILENAME.exec(file);
    expect(match, `bad file name: ${file}`).not.toBeNull();
    const fixture = valid.find((f) => f.file === file);
    expect(fixture?.id).toBe(match?.[1]);
  });

  it("numbers fixtures 001..N with no gaps or duplicates", () => {
    const ids = valid.map((f) => f.id);
    const expectedIds = ids.map((_, i) => String(i + 1).padStart(3, "0"));
    expect(ids).toEqual(expectedIds);
  });

  it("has the required category mix (5 normal, 4 vague, 4 contradictory, 4 missing_info, 3 complex)", () => {
    const counts = Object.fromEntries(
      FIXTURE_CATEGORIES.map((c) => [c, valid.filter((f) => f.category === c).length]),
    );
    expect(counts).toEqual(CATEGORY_TARGETS);
    expect(files).toHaveLength(20);
  });

  it("marks exactly one quick fixture per category for eval:quick", () => {
    const quick = valid.filter((f) => f.quick === true);
    expect(quick).toHaveLength(QUICK_SET_SIZE);
    expect(new Set(quick.map((f) => f.category))).toEqual(new Set(FIXTURE_CATEGORIES));
  });
});

describe("EvalFixture schema", () => {
  const base = {
    id: "999",
    category: "normal",
    project: { domain: "fintech", audience: "retail customers", teamSize: 5 },
    input: "Customers can view and filter their transactions.",
    expected: {
      requirements: ["view transactions"],
      questionsAbout: ["who can access it"],
      conflicts: [],
      ambiguousTerms: [],
      mustNotInvent: ["SMS notifications"],
    },
  };

  it("accepts a minimal valid fixture", () => {
    expect(EvalFixture.safeParse(base).success).toBe(true);
  });

  it("rejects a contradictory fixture with no conflicts", () => {
    expect(EvalFixture.safeParse({ ...base, category: "contradictory" }).success).toBe(false);
  });

  it("rejects unknown keys so typos in field names are caught", () => {
    expect(EvalFixture.safeParse({ ...base, expectd: {} }).success).toBe(false);
  });

  it("rejects a fixture that expects no clarifying questions", () => {
    const noQuestions = { ...base, expected: { ...base.expected, questionsAbout: [] } };
    expect(EvalFixture.safeParse(noQuestions).success).toBe(false);
  });
});
