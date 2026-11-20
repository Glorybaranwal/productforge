/**
 * Sprint planning (PF-074, ADR-030): settings, sprints and story placements. Placements point at
 * stories by code, so a new story version keeps its place (ADR-017). Members read the plan; owners,
 * admins and PMs change it, as the service already requires.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { createdAt, updatedAt } from "./columns";
import { MANAGERS, memberOf, roleIn } from "./policies";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

const workspace = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

const projectFk = (table: string, t: { projectId: AnyPgColumn; workspaceId: AnyPgColumn }) =>
  foreignKey({
    name: `${table}_project_fk`,
    columns: [t.projectId, t.workspaceId],
    foreignColumns: [projects.id, projects.workspaceId],
  }).onDelete("cascade");

/** Members read; owners, admins and PMs write. */
const managed = (table: string, workspaceId: AnyPgColumn, del = true) => [
  pgPolicy(`${table}_select_member`, {
    for: "select",
    to: authenticatedRole,
    using: memberOf(workspaceId),
  }),
  pgPolicy(`${table}_insert_manager`, {
    for: "insert",
    to: authenticatedRole,
    withCheck: roleIn(workspaceId, MANAGERS),
  }),
  pgPolicy(`${table}_update_manager`, {
    for: "update",
    to: authenticatedRole,
    using: roleIn(workspaceId, MANAGERS),
    withCheck: roleIn(workspaceId, MANAGERS),
  }),
  ...(del
    ? [
        pgPolicy(`${table}_delete_manager`, {
          for: "delete",
          to: authenticatedRole,
          using: roleIn(workspaceId, MANAGERS),
        }),
      ]
    : []),
];

export const sprintSettings = pgTable(
  "sprint_settings",
  {
    projectId: uuid("project_id").primaryKey(),
    workspaceId: workspace(),
    velocity: integer("velocity").notNull(),
    startDate: date("start_date").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    projectFk("sprint_settings", t),
    check("sprint_settings_velocity", sql`${t.velocity} between 1 and 500`),
    ...managed("sprint_settings", t.workspaceId, false),
  ],
).enableRLS();

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspace(),
    projectId: uuid("project_id").notNull(),
    number: integer("number").notNull(),
    goal: varchar("goal", { length: 300 }).notNull(),
    autoGoal: boolean("auto_goal").notNull(),
    capacityPoints: integer("capacity_points").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    projectFk("sprints", t),
    unique("sprints_project_number_key").on(t.projectId, t.number),
    check("sprints_number_positive", sql`${t.number} > 0`),
    check("sprints_capacity", sql`${t.capacityPoints} between 0 and 500`),
    ...managed("sprints", t.workspaceId),
  ],
).enableRLS();

export const sprintItems = pgTable(
  "sprint_items",
  {
    workspaceId: workspace(),
    projectId: uuid("project_id").notNull(),
    storyCode: varchar("story_code", { length: 12 }).notNull(),
    sprintNumber: integer("sprint_number").notNull(),
    position: integer("position").notNull(),
    pinned: boolean("pinned").notNull(),
    reason: varchar("reason", { length: 300 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "sprint_items_pkey", columns: [t.projectId, t.storyCode] }),
    projectFk("sprint_items", t),
    // A placement goes with its sprint.
    foreignKey({
      name: "sprint_items_sprint_fk",
      columns: [t.projectId, t.sprintNumber],
      foreignColumns: [sprints.projectId, sprints.number],
    }).onDelete("cascade"),
    check("sprint_items_story_code", sql`${t.storyCode} ~ '^US-[0-9]{3,}$'`),
    ...managed("sprint_items", t.workspaceId),
  ],
).enableRLS();
