import { z } from "zod";

/** Largest text source we accept (characters). Keeps prompts within model limits. */
export const MAX_SOURCE_CHARS = 50_000;
export const ACCEPTED_FILE_TYPES = [".txt", ".md", ".markdown", ".csv"] as const;

export const SourceDocument = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(["paste", "file"]),
  /** Uploaded text is untrusted data, never instructions (CLAUDE.md §7.8). */
  text: z.string(),
  charCount: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const SourceInput = z.object({
  name: z.string().trim().min(1, "Give the source a name").max(120),
  kind: z.enum(["paste", "file"]).default("paste"),
  text: z
    .string()
    .trim()
    .min(10, "Add at least a sentence of text")
    .max(
      MAX_SOURCE_CHARS,
      `Sources are limited to ${MAX_SOURCE_CHARS.toLocaleString("en")} characters`,
    ),
});
export type SourceInput = z.infer<typeof SourceInput>;
