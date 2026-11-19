/**
 * Deterministic technical-task writer for demo mode (ADR-011): a small, typical breakdown per kind
 * of story (data, API, UI, tests…) with hour estimates, and story points from the total.
 */
import type { TaskInput, TaskOutput } from "@/src/ai/schemas/backlog";
import { STORY_POINTS, storyPointsFromHours } from "@/src/modules/stories/schema";

type Task = TaskOutput["tasks"][number];
type Row = [title: string, description: string, hours: number];

const INTEGRATION =
  /\b(api|integrat\w*|sap|erp|crm|soap|provider|gateway|sso|single sign-on|existing system|batch|sync\w*)\b/i;

function kindOf(iWant: string, text: string, nonFunctional: boolean): string {
  if (nonFunctional) return "quality";
  const phrase = iWant
    .replace(/^to\s+/i, "")
    .replace(/^(?:get|be)\s+notified\s+and\s+/i, "")
    .replace(/^\w+ly\s+/i, "");
  const verb = phrase.split(/[\s,]+/)[0]?.toLowerCase() ?? "";
  if (/^(upload|scan|attach)$/.test(verb)) return "upload";
  if (/^(export|download|print|generate)$/.test(verb)) return "export";
  if (
    /^(pay|refund|checkout|buy|purchase|subscribe)$/.test(verb) ||
    /\brefund|\bpay(?:ment)?s?\b/i.test(phrase)
  )
    return "pay";
  if (/^(approve|reject|review|assign|verify|confirm|escalate)$/.test(verb)) return "decide";
  if (
    /^(receive|notify|alert|remind|send)$/.test(verb) ||
    /\b(notif\w*|alerts?|remind\w*|sms|push)\b/i.test(phrase)
  )
    return "notify";
  if (/^(view|see|filter|search|find|browse|sort|list|check|track)$/.test(verb)) return "find";
  if (/^(edit|update|change|cancel|delete|remove|manage|mark|reschedule)$/.test(verb))
    return "change";
  if (
    /^(submit|create|add|register|self-register|request|record|enter|place|apply|file|book|order|sign|complete)$/.test(
      verb,
    )
  )
    return "create";
  if (/\b(keep|retain|store|delete)\b.*\b(years?|days?|months?)\b/i.test(text)) return "retention";
  return "default";
}

function short(text: string, max = 48): string {
  const clean = text
    .replace(/^to\s+/i, "")
    .replace(/^(?:it|the product)\s+to\s+(?:ensure\s+that\s+)?/i, "")
    .replace(/\bmy\s+/g, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")) || cut}…`;
}

function rowsFor(kind: string, what: string, filters: boolean): Row[] {
  switch (kind) {
    case "create":
      return [
        ["Data: model and migration", `Table, constraints and validation for: ${what}.`, 4],
        [
          "API: create endpoint",
          "POST endpoint with Zod validation, idempotency and an audit-log entry.",
          6,
        ],
        ["UI: form", "Form with inline validation, error states and a confirmation screen.", 8],
      ];
    case "upload":
      return [
        [
          "Storage: upload bucket and limits",
          "Bucket, allowed types, size limit and virus scan hook.",
          4,
        ],
        [
          "API: signed upload URL",
          "Endpoint issuing short-lived upload URLs and recording the file.",
          5,
        ],
        ["UI: upload control", "Drag-and-drop with progress, retry and file list.", 6],
      ];
    case "find":
      return [
        ["API: query endpoint", `Paged results scoped to the user's access for: ${what}.`, 6],
        ...(filters
          ? ([["Data: indexes for filters", "Indexes for the filter and sort fields.", 2]] as Row[])
          : []),
        [
          "UI: list view",
          "List with loading, empty and error states" + (filters ? " and filter controls." : "."),
          filters ? 10 : 8,
        ],
      ];
    case "export":
      return [
        ["API: export job", "Builds the file from the selected period; streams large files.", 6],
        ["UI: download control", "Period picker and download button with progress.", 3],
      ];
    case "notify":
      return [
        ["Event: detect the trigger", `Emit an event when it happens: ${what}.`, 4],
        [
          "Notification: template and sender",
          "Message template, sending job with retries, delivery log.",
          6,
        ],
        ["Settings: notification preferences", "Let people turn this notification on or off.", 4],
      ];
    case "decide":
      return [
        [
          "API: decision endpoint",
          "Status transitions, guard against double decisions, audit log.",
          6,
        ],
        [
          "UI: review queue and decision",
          "Queue of pending items with approve/reject and a comment.",
          8,
        ],
        ["Notify the requester", "Tell the requester about the decision.", 3],
      ];
    case "pay":
      return [
        ["Integration: payment provider", "Payment intent, webhooks and reconciliation.", 12],
        ["Idempotent payment retries", "Idempotency keys so retries never charge twice.", 4],
        ["UI: payment step and receipt", "Payment form, declined state and receipt.", 8],
      ];
    case "change":
      return [
        ["API: update endpoint with rules", "Update with cut-off rules and optimistic locking.", 5],
        ["UI: change action", "Action with confirmation and a clear error when not allowed.", 5],
      ];
    case "retention":
      return [
        [
          "Data: retention policy",
          "Retention period per record type; deletion blocked inside it.",
          4,
        ],
        [
          "Job: scheduled clean-up",
          "Nightly job applying the rule, with an audit-log entry per record.",
          6,
        ],
      ];
    case "quality":
      return [
        [
          "Measure: automated check",
          `A test or monitor that fails when this isn't met: ${what}.`,
          6,
        ],
        ["Implement: meet the target", "Changes needed to meet the requirement in production.", 8],
        ["Definition of Done", "Add the requirement to the team's Definition of Done.", 1],
      ];
    default:
      return [
        ["API: endpoint", `Server logic and validation for: ${what}.`, 6],
        ["UI: screen", "Screen with loading, empty and error states.", 6],
      ];
  }
}

export function runDemoTasks(input: TaskInput): TaskOutput {
  const tasks: Task[] = [];
  const estimates: TaskOutput["estimates"] = [];
  const pinned = /\b(\d{1,2})\s*(?:story\s+)?points?\b/i.exec(input.note ?? "")?.[1];
  for (const story of input.stories) {
    const primary = story.requirements[0];
    const text = story.requirements.map((r) => r.text).join(" ");
    const kind = kindOf(story.iWant, text, primary?.type === "non_functional");
    const what = short(story.iWant);
    const rows: Row[] = [
      ...rowsFor(kind, what, /\b(filter|search|sort)\w*/i.test(story.iWant)),
      ...(kind !== "pay" && INTEGRATION.test(text)
        ? ([
            [
              "Integration: connect the external system",
              "Client, retries and error handling for the system named in the requirement.",
              12,
            ],
          ] as Row[])
        : []),
      ...(story.requirements.length > 1
        ? ([
            [
              `Rules and details: ${story.requirements
                .slice(1)
                .map((r) => r.code)
                .join(", ")}`,
              "Implement the linked rules and details, with clear messages when a rule blocks an action.",
              2 + story.requirements.length,
            ],
          ] as Row[])
        : []),
      [
        "Tests: automate the acceptance criteria",
        `${story.criteria.length} Given/When/Then cases as automated tests.`,
        Math.max(2, Math.ceil(story.criteria.length * 1.5)),
      ],
    ];
    for (const [title, description, estimateHours] of rows) {
      tasks.push({ storyCode: story.code, title, description, estimateHours });
    }
    const total = rows.reduce((n, r) => n + r[2], 0);
    const asked = Number(pinned);
    const storyPoints = (STORY_POINTS as readonly number[]).includes(asked)
      ? (asked as (typeof STORY_POINTS)[number])
      : storyPointsFromHours(total);
    estimates.push({ storyCode: story.code, storyPoints });
  }
  return { tasks, estimates };
}
