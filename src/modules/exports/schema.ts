import { z } from "zod";

/**
 * Jira editions differ in how epics link to stories (ADR-016):
 * - `cloud`: Issue ID + Parent (Epic Link was deprecated in Jira Cloud in 2024).
 * - `datacenter`: Epic Name + Epic Link for epics, Issue Id + Parent Id for sub-tasks.
 */
export const JIRA_TARGETS = ["cloud", "datacenter"] as const;
export type JiraTarget = (typeof JIRA_TARGETS)[number];
export const JIRA_TARGET_LABELS: Record<JiraTarget, string> = {
  cloud: "Jira Cloud",
  datacenter: "Jira Data Center",
};

export const JiraExportOptions = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  target: z.enum(JIRA_TARGETS).default("cloud"),
  /** Technical tasks become sub-tasks of their story. */
  includeTasks: z.boolean().default(true),
  /** The sub-task type's name on the Jira site ("Sub-task" by default; some Cloud sites say "Subtask"). */
  subtaskType: z
    .string()
    .trim()
    .min(1, "Enter the sub-task type's name")
    .max(40)
    .default("Sub-task"),
});
export type JiraExportOptions = z.infer<typeof JiraExportOptions>;

/** One block of a description; rendered as plain text for CSV and as Atlassian Document Format for JSON. */
export type DescriptionBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] };

export type JiraItem = {
  /** Sequential id inside the file; parents always come before their children. */
  id: number;
  parentId: number | null;
  level: "epic" | "story" | "subtask";
  /** ProductForge code: EP-01, US-001, TASK-001. */
  ref: string;
  summary: string;
  description: DescriptionBlock[];
  /** Jira priority name (stories only). */
  priority: "High" | "Medium" | "Low" | null;
  storyPoints: number | null;
  /** Hours (sub-tasks only); CSV writes seconds, JSON writes "1h 30m". */
  estimateHours: number | null;
  labels: string[];
  /** Data Center: epic name (epics) and the epic it belongs to (stories). */
  epicName: string | null;
};

export type JiraPlan = {
  items: JiraItem[];
  counts: { epics: number; stories: number; subtasks: number; points: number; hours: number };
  /** Current stories that are not exported, and why. */
  excluded: { drafts: string[]; rejected: string[] };
  prdVersion: number | null;
  gate3Passed: boolean;
  warnings: string[];
};

export type ExportRecord = {
  at: string;
  actor: string;
  /** "Jira CSV (Jira Cloud)", "PRD Markdown", "Traceability CSV"… */
  what: string;
  detail: string;
};
