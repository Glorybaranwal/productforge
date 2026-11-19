/**
 * Business-rule validator (PF-044). Pure functions shared by the story, QA and task stages (as
 * retry feedback for the model) and by Gate 3 (as blockers and warnings for people).
 * Errors block; warnings are shown but never block.
 */

export type RuleName =
  | "orphan_story"
  | "uncovered_requirement"
  | "duplicate_code"
  | "unknown_dependency"
  | "dependency_cycle"
  | "missing_criteria"
  | "missing_tasks"
  | "oversized_task"
  | "vague_criterion";

export type RuleViolation = {
  rule: RuleName;
  severity: "error" | "warning";
  message: string;
  /** Codes involved (story, requirement), for linking in the UI. */
  codes: string[];
};

type StoryLike = { code: string; requirementCodes: string[]; dependsOn: string[] };
type CriterionLike = {
  storyCode: string;
  kind: "positive" | "negative" | "edge";
  given: string;
  when: string;
  then: string;
};
type TaskLike = { storyCode: string; title: string; estimateHours: number | null | undefined };

const error = (rule: RuleName, message: string, codes: string[]): RuleViolation => ({
  rule,
  severity: "error",
  message,
  codes,
});
const warning = (rule: RuleName, message: string, codes: string[]): RuleViolation => ({
  rule,
  severity: "warning",
  message,
  codes,
});

/** Every story links ≥ 1 requirement, and only to requirements that exist (traceability). */
export function orphanStories(stories: StoryLike[], knownCodes: Iterable<string>): RuleViolation[] {
  const known = new Set(knownCodes);
  return stories.flatMap((s) => {
    if (s.requirementCodes.length === 0) {
      return [error("orphan_story", `${s.code} isn't linked to any requirement`, [s.code])];
    }
    const unknown = s.requirementCodes.filter((c) => !known.has(c));
    return unknown.length
      ? [
          error(
            "orphan_story",
            `${s.code} links to requirements that aren't approved: ${unknown.join(", ")}`,
            [s.code, ...unknown],
          ),
        ]
      : [];
  });
}

/** Each required requirement code is linked by at least one story. */
export function uncoveredRequirements(
  stories: StoryLike[],
  requiredCodes: Iterable<string>,
): RuleViolation[] {
  const linked = new Set(stories.flatMap((s) => s.requirementCodes));
  return [...requiredCodes]
    .filter((c) => !linked.has(c))
    .map((c) => error("uncovered_requirement", `${c} has no story`, [c]));
}

export function duplicateCodes(items: { code: string }[], label = "Code"): RuleViolation[] {
  const counts = new Map<string, number>();
  for (const { code } of items) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n > 1)
    .map(([code, n]) => error("duplicate_code", `${label} ${code} is used ${n} times`, [code]));
}

/** Dependencies must point at other stories that exist. */
export function unknownDependencies(
  stories: StoryLike[],
  knownStoryCodes: Iterable<string>,
): RuleViolation[] {
  const known = new Set(knownStoryCodes);
  return stories.flatMap((s) =>
    s.dependsOn
      .filter((d) => d === s.code || !known.has(d))
      .map((d) =>
        error(
          "unknown_dependency",
          d === s.code ? `${s.code} depends on itself` : `${s.code} depends on unknown story ${d}`,
          [s.code, d],
        ),
      ),
  );
}

/** Reports each dependency cycle once, e.g. "US-002 → US-005 → US-002". */
export function dependencyCycles(stories: StoryLike[]): RuleViolation[] {
  const graph = new Map(stories.map((s) => [s.code, s.dependsOn.filter((d) => d !== s.code)]));
  const state = new Map<string, "visiting" | "done">();
  const seen = new Set<string>();
  const out: RuleViolation[] = [];
  const stack: string[] = [];

  const visit = (code: string) => {
    state.set(code, "visiting");
    stack.push(code);
    for (const next of graph.get(code) ?? []) {
      if (!graph.has(next)) continue;
      if (state.get(next) === "visiting") {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);
          out.push(
            error("dependency_cycle", `Dependency cycle: ${[...cycle, next].join(" → ")}`, cycle),
          );
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(code, "done");
  };
  for (const code of graph.keys()) if (!state.has(code)) visit(code);
  return out;
}

/** PF-040: ≥ 2 criteria per story, including ≥ 1 negative or edge case. */
export function missingCriteria(
  stories: { code: string }[],
  criteria: CriterionLike[],
): RuleViolation[] {
  return stories.flatMap((s) => {
    const mine = criteria.filter((c) => c.storyCode === s.code);
    if (mine.length < 2) {
      return [
        error(
          "missing_criteria",
          `${s.code} needs at least 2 acceptance criteria (has ${mine.length})`,
          [s.code],
        ),
      ];
    }
    return mine.some((c) => c.kind !== "positive")
      ? []
      : [error("missing_criteria", `${s.code} needs a negative or edge-case criterion`, [s.code])];
  });
}

/** PF-041: every story has tasks, and every task has an estimate. */
export function missingTasks(stories: { code: string }[], tasks: TaskLike[]): RuleViolation[] {
  return stories.flatMap((s) => {
    const mine = tasks.filter((t) => t.storyCode === s.code);
    if (mine.length === 0) return [error("missing_tasks", `${s.code} has no tasks`, [s.code])];
    const unestimated = mine.filter((t) => !t.estimateHours || t.estimateHours <= 0);
    return unestimated.length
      ? [
          error("missing_tasks", `${s.code}: ${unestimated.length} task(s) without an estimate`, [
            s.code,
          ]),
        ]
      : [];
  });
}

/** Tasks longer than two days are hard to track; suggest splitting. */
export function oversizedTasks(tasks: TaskLike[], maxHours = 16): RuleViolation[] {
  return tasks
    .filter((t) => (t.estimateHours ?? 0) > maxHours)
    .map((t) =>
      warning(
        "oversized_task",
        `${t.storyCode}: "${t.title}" is ${t.estimateHours} h — consider splitting it`,
        [t.storyCode],
      ),
    );
}

/** Words that make a criterion untestable unless a number pins them down. */
const VAGUE: [RegExp, string][] = [
  [/\b(fast|quick(?:ly)?|slow(?:ly)?|instant(?:ly)?|promptly|real[- ]time)\b/i, "add a time limit"],
  [
    /\b(easy|easily|simple|intuitive|user[- ]friendly|seamless(?:ly)?|smooth(?:ly)?)\b/i,
    "say how it will be measured",
  ],
  [
    /\b(appropriate(?:ly)?|properly|correctly|as expected|reasonable|acceptable|adequate)\b/i,
    "say exactly what to check",
  ],
  [
    /\b(nice|good|better|modern|clean|robust|efficient(?:ly)?|scalable)\b/i,
    "name a measurable target",
  ],
  [/\b(etc\.?|and so on|some|several|many|a few)\b/i, "list the cases"],
  [/\b(todo|tbd)\b/i, "fill in the placeholder"],
];

/** Flags for one criterion, e.g. `"quickly" isn't measurable — add a time limit`. */
export function criterionFlags(c: Pick<CriterionLike, "given" | "when" | "then">): string[] {
  const flags: string[] = [];
  for (const part of [c.given, c.when, c.then]) {
    if (/\d/.test(part)) continue; // a number makes the vague word measurable
    for (const [re, fix] of VAGUE) {
      const m = re.exec(part);
      if (m && !flags.some((f) => f.startsWith(`"${m[0].toLowerCase()}"`))) {
        flags.push(`"${m[0].toLowerCase()}" isn't testable — ${fix}`);
      }
    }
  }
  if (c.then.trim().split(/\s+/).length < 3) {
    flags.push("The expected result is too short to test — describe what you'll see");
  }
  return flags;
}

export function vagueCriteria(criteria: CriterionLike[]): RuleViolation[] {
  return criteria.flatMap((c) =>
    criterionFlags(c).map((flag) =>
      warning("vague_criterion", `${c.storyCode}: ${flag}`, [c.storyCode]),
    ),
  );
}

export const errorsOf = (violations: RuleViolation[]) =>
  violations.filter((v) => v.severity === "error");
export const messages = (violations: RuleViolation[]) => violations.map((v) => v.message);
