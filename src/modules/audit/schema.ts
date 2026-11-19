import { z } from "zod";

export const AuditLog = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** Null once the actor’s account is deleted; `actorName` keeps the entry readable. */
  actorId: z.string().min(1).nullable(),
  actorName: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  /** Dotted verb, e.g. `project.created`, `project.updated`. */
  action: z.string().min(1),
  /** For updates: `{ field: { from, to } }`. */
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLog = z.infer<typeof AuditLog>;
