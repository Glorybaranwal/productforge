/**
 * The backlog (PF-073, ADR-029): epics, versioned stories, acceptance criteria and technical tasks.
 * Links to requirements and to other stories are codes (FR-01, US-002), as everywhere else, because
 * codes outlive versions. RLS mirrors the product rules: members read and edit drafts; owners,
 * admins and PMs create stories and move them between statuses (Gate 3); an APPROVED story and its
 * criteria and tasks never change — a change is a new version (ADR-006). Nothing is deleted but a
 * draft's own criteria and tasks.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { CRITERION_KINDS, PRIORITIES } from "../../modules/stories/schema";

import { agentRuns } from "./agent-runs";
import { createdAt, updatedAt } from "./columns";
import { MANAGERS, memberOf, roleIn } from "./policies";
import { projects } from "./projects";
import { artifactOrigin, artifactStatus, evidenceLabel } from "./requirements";
import { workspaces } from "./workspaces";

export const storyPriority = pgEnum("story_priority", PRIORITIES);
export const criterionKind = pgEnum("criterion_kind", CRITERION_KINDS);

/** Columns every generated row carries (CLAUDE.md §7.3). */
const generated = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  status: artifactStatus("status").notNull(),
  evidence: evidenceLabel("evidence").notNull(),
  origin: artifactOrigin("origin").notNull(),
  agentRunId: uuid("agent_run_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

type Owned = { workspaceId: AnyPgColumn; projectId: AnyPgColumn; agentRunId: AnyPgColumn };

/** Same-workspace foreign keys to the project and to the run that wrote the row. */
const ownerKeys = (table: string, t: Owned) => [
  foreignKey({
    name: `${table}_project_fk`,
    columns: [t.projectId, t.workspaceId],
    foreignColumns: [projects.id, projects.workspaceId],
  }).onDelete("cascade"),
  foreignKey({
    name: `${table}_agent_run_fk`,
    columns: [t.agentRunId, t.workspaceId],
    foreignColumns: [agentRuns.id, agentRuns.workspaceId],
  }),
  index(`${table}_project_idx`).on(t.workspaceId, t.projectId),
];

const read = (table: string, workspaceId: AnyPgColumn) =>
  pgPolicy(`${table}_select_member`, {
    for: "select",
    to: authenticatedRole,
    using: memberOf(workspaceId),
  });

/** Drafts are members' to edit; other statuses take a manager; approved rows never change. */
const editDrafts = (table: string, workspaceId: AnyPgColumn, status: AnyPgColumn) => {
  const allowed: SQL = sql`${memberOf(workspaceId)} and (${status} = 'DRAFT' or ${roleIn(workspaceId, MANAGERS)})`;
  return pgPolicy(`${table}_update_unapproved`, {
    for: "update",
    to: authenticatedRole,
    using: sql`${allowed} and ${status} <> 'APPROVED'`,
    withCheck: allowed,
  });
};

export const epics = pgTable(
  "epics",
  {
    ...generated(),
    code: varchar("code", { length: 12 }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
  },
  (t) => [
    ...ownerKeys("epics", t),
    unique("epics_id_workspace_id_key").on(t.id, t.workspaceId),
    unique("epics_project_code_key").on(t.projectId, t.code),
    check("epics_code_format", sql`${t.code} ~ '^EP-[0-9]{2,}$'`),
    read("epics", t.workspaceId),
    pgPolicy("epics_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    // An epic's status follows its stories (refreshEpics); any member's action can move it.
    pgPolicy("epics_update_member", {
      for: "update",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
      withCheck: memberOf(t.workspaceId),
    }),
  ],
).enableRLS();

export const stories = pgTable(
  "stories",
  {
    ...generated(),
    epicId: uuid("epic_id").notNull(),
    code: varchar("code", { length: 12 }).notNull(),
    version: integer("version").notNull(),
    basedOnVersion: integer("based_on_version"),
    title: varchar("title", { length: 120 }).notNull(),
    asA: varchar("as_a", { length: 80 }).notNull(),
    iWant: varchar("i_want", { length: 300 }).notNull(),
    soThat: varchar("so_that", { length: 300 }).notNull(),
    priority: storyPriority("priority").notNull(),
    storyPoints: integer("story_points"),
    requirementCodes: text("requirement_codes").array().notNull(),
    dependsOn: text("depends_on").array().notNull(),
    rationale: text("rationale"),
    rejectionReason: text("rejection_reason"),
    prdVersion: integer("prd_version"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    // Who approved it, by name (a snapshot, like `prds.approved_by`).
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    ...ownerKeys("stories", t),
    foreignKey({
      name: "stories_epic_fk",
      columns: [t.epicId, t.workspaceId],
      foreignColumns: [epics.id, epics.workspaceId],
    }),
    unique("stories_id_workspace_id_key").on(t.id, t.workspaceId),
    unique("stories_project_code_version_key").on(t.projectId, t.code, t.version),
    index("stories_requirement_codes_idx").using("gin", t.requirementCodes),
    check("stories_code_format", sql`${t.code} ~ '^US-[0-9]{3,}$'`),
    check("stories_version_positive", sql`${t.version} > 0`),
    check("stories_points", sql`${t.storyPoints} is null or ${t.storyPoints} in (1, 2, 3, 5, 8, 13)`),
    check("stories_requirements_linked", sql`cardinality(${t.requirementCodes}) >= 1`),
    read("stories", t.workspaceId),
    pgPolicy("stories_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    editDrafts("stories", t.workspaceId, t.status),
  ],
).enableRLS();

/** Criteria and tasks belong to one story version and share its status. */
const childOf = (table: string, t: Owned & { storyId: AnyPgColumn; status: AnyPgColumn }) => [
  ...ownerKeys(table, t),
  foreignKey({
    name: `${table}_story_fk`,
    columns: [t.storyId, t.workspaceId],
    foreignColumns: [stories.id, stories.workspaceId],
  }).onDelete("cascade"),
  index(`${table}_story_idx`).on(t.storyId),
  read(table, t.workspaceId),
  pgPolicy(`${table}_insert_unapproved`, {
    for: "insert",
    to: authenticatedRole,
    withCheck: sql`${memberOf(t.workspaceId)} and (${t.status} = 'DRAFT' or ${roleIn(t.workspaceId, MANAGERS)})`,
  }),
  editDrafts(table, t.workspaceId, t.status),
  // Saving a draft replaces its criteria and tasks; regenerating a rejected story clears them.
  pgPolicy(`${table}_delete_unapproved`, {
    for: "delete",
    to: authenticatedRole,
    using: sql`${memberOf(t.workspaceId)} and (${t.status} = 'DRAFT' or (${roleIn(t.workspaceId, MANAGERS)} and ${t.status} <> 'APPROVED'))`,
  }),
];

export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    ...generated(),
    storyId: uuid("story_id").notNull(),
    kind: criterionKind("kind").notNull(),
    given: varchar("given", { length: 400 }).notNull(),
    when: varchar("when", { length: 400 }).notNull(),
    then: varchar("then", { length: 400 }).notNull(),
    position: integer("position").notNull(),
  },
  (t) => childOf("acceptance_criteria", t),
).enableRLS();

export const technicalTasks = pgTable(
  "technical_tasks",
  {
    ...generated(),
    storyId: uuid("story_id").notNull(),
    code: varchar("code", { length: 12 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    estimateHours: numeric("estimate_hours", { precision: 4, scale: 1, mode: "number" }).notNull(),
    position: integer("position").notNull(),
    // Sprints move to Postgres in PF-074; this becomes a foreign key then.
    sprintId: uuid("sprint_id"),
  },
  (t) => [
    ...childOf("technical_tasks", t),
    check("technical_tasks_code_format", sql`${t.code} ~ '^TASK-[0-9]{3,}$'`),
    check("technical_tasks_hours", sql`${t.estimateHours} between 0.5 and 40`),
  ],
).enableRLS();
