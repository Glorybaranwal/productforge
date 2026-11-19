import { timestamp } from "drizzle-orm/pg-core";

/** Shared timestamp columns: UTC instants, set by the database. */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
