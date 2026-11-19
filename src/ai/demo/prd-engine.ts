/**
 * Deterministic PRD writer for demo mode (ADR-011). It only restates approved requirements and the
 * clarification record; anything it drafts itself (problem framing, proposed metrics) is listed
 * under assumptions for the PM to confirm.
 */
import type { PrdInput } from "@/src/ai/schemas/prd";
import type { PrdContent, TracedItem } from "@/src/modules/prd/schema";

import { capability, capitalize, lowerFirst, unique } from "./text";

type Req = PrdInput["requirements"][number];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const METRICS: [RegExp, string][] = [
  [/\b(fast|speed|load|performance|response)\b/i, "95 % of pages load in under 2 seconds"],
  [
    /\b(notif\w*|alerts?|remind\w*)\b/i,
    "95 % of notifications arrive within 1 minute of the trigger",
  ],
  [
    /\b(reports?|exports?|download\w*)\b/i,
    "Reports for a year of data generate in under 10 seconds",
  ],
  [/\b(book\w*|schedul\w*|appointments?)\b/i, "A booking is completed online in under 2 minutes"],
  [/\b(pay\w*|refund\w*|checkout)\b/i, "98 % of payments succeed on the first attempt"],
  [/\b(approv\w*|review\w*)\b/i, "Median approval time halves within 3 months"],
  [
    /\b(filter\w*|search\w*|find|view|see|track\w*)\b/i,
    "Users find what they need in under 30 seconds in usability tests",
  ],
];
const DEFAULT_METRIC = "Used weekly by at least 60 % of target users within 3 months of launch";

function metricFor(text: string): string {
  return METRICS.find(([re]) => re.test(text))?.[1] ?? DEFAULT_METRIC;
}

const INTEGRATION =
  /\b(api|integrat\w*|sap|systems?|providers?|gateway|sso|single sign-on|existing|third[- ]party|vendors?|stripe|whatsapp|batch)\b/i;

const item = (r: Req): TracedItem => ({ text: r.text, requirementCodes: [r.code] });

export function runDemoPrd(input: PrdInput): PrdContent {
  const { project, discovery, requirements } = input;
  const settled = requirements.filter(
    (r) => r.evidence === "EXPLICIT" || r.evidence === "INFERRED",
  );
  let functional = settled.filter((r) => r.type === "functional");
  const nonFunctional = settled.filter((r) => r.type === "non_functional");
  const assumed = requirements.filter((r) => r.evidence === "ASSUMPTION");
  const open = requirements.filter((r) => r.evidence === "OPEN_QUESTION");
  if (functional.length === 0) functional = requirements.slice(0, 1); // a PRD needs ≥ 1 functional item

  const capabilities = unique(
    functional.map((r) => capability(r.text)),
    (c) => c.toLowerCase(),
  );
  const top = capabilities.slice(0, 3).map(lowerFirst);

  const summary =
    `${project.name} is a ${project.domain} product for ${lowerFirst(project.audience)}. ` +
    `This release covers ${functional.length} functional and ${nonFunctional.length} non-functional requirement` +
    `${nonFunctional.length === 1 ? "" : "s"} confirmed at Gate 1` +
    (discovery.actors.length
      ? `, used by ${joinList(discovery.actors.slice(0, 3).map(lowerFirst))}.`
      : ".");

  const problem = [
    `Stakeholders asked for a way for ${lowerFirst(project.audience)} to ${joinList(top)}.`,
    discovery.goals[0] ? `Stated goal: ${discovery.goals[0].replace(/[.]+$/, "")}.` : "",
    discovery.constraints.length
      ? `Key constraints: ${discovery.constraints
          .slice(0, 2)
          .map((c) => c.replace(/[.]+$/, ""))
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const goalSources = discovery.goals.length
    ? discovery.goals.slice(0, 3)
    : capabilities.slice(0, 3);
  const goals = goalSources.map((g) => ({
    goal: capitalize(g.replace(/[.]+$/, "")),
    metric: metricFor(g),
  }));

  const actors = discovery.actors.length
    ? discovery.actors.slice(0, 4)
    : [capitalize(project.audience)];
  const personas = actors.map((name) => {
    const stem = name.toLowerCase().replace(/s$/, "");
    const mine = functional.find((r) => r.text.toLowerCase().includes(stem));
    return {
      name,
      needs: mine
        ? `Needs to ${lowerFirst(capability(mine.text))}.`
        : `Needs to ${top[0] ?? "use the product"}.`,
    };
  });

  const dependencies = unique(
    [...discovery.constraints, ...requirements.map((r) => r.text)]
      .filter((t) => INTEGRATION.test(t))
      .map((t) => t.replace(/[.]+$/, "")),
    (t) => t.toLowerCase(),
  ).slice(0, 5);

  const assumptions: TracedItem[] = [
    ...assumed.map(item),
    {
      text: "The problem statement, goals and success metrics were drafted from the approved requirements — confirm them with stakeholders.",
      requirementCodes: [],
    },
  ];

  const openQuestions: TracedItem[] = [
    ...open.map(item),
    ...input.clarifications
      .filter((c) => c.state === "skipped")
      .map((c) => ({ text: `Skipped during clarification: ${c.question}`, requirementCodes: [] })),
  ];

  const risks = [
    ...input.conflicts.map((c) => ({
      risk: `Unresolved disagreement: ${c.description}`,
      mitigation: `Decide before build: ${c.question}`,
    })),
    ...(openQuestions.length
      ? [
          {
            risk: `${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"} could change scope`,
            mitigation:
              "Give each open question an owner and a decision date before sprint planning.",
          },
        ]
      : []),
    ...(assumed.length
      ? [
          {
            risk: "Assumptions may be wrong",
            mitigation:
              "Validate each assumption with stakeholders before stories are approved (Gate 3).",
          },
        ]
      : []),
    ...(nonFunctional.length === 0
      ? [
          {
            risk: "No non-functional requirements were captured",
            mitigation: "Agree performance, security and availability targets before build.",
          },
        ]
      : []),
  ];

  return {
    summary,
    problem,
    goals,
    personas,
    inScope: capabilities.slice(0, 10).map(capitalize),
    outOfScope: input.rejected
      .slice(0, 6)
      .map((t) => `Not in this release: ${t.replace(/[.]+$/, "")}`),
    functionalRequirements: functional.map(item),
    nonFunctionalRequirements: nonFunctional.map(item),
    dependencies,
    assumptions,
    risks,
    openQuestions,
  };
}
