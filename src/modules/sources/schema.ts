import { z } from "zod";

/** Largest text source we accept (characters). Keeps prompts within model limits. */
export const MAX_SOURCE_CHARS = 50_000;
export const ACCEPTED_FILE_TYPES = [".pdf", ".docx", ".txt", ".md", ".markdown", ".csv"] as const;
/** Upload limits (D-08, SEC-11): bytes on the wire, PDF pages, and unpacked size of a .docx. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;
export const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;

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
