/**
 * Server-side text extraction for uploaded sources (PF-023, ADR-033). Checks come first, so a
 * parser only ever sees a file of the type it claims, within the limits (D-08, SEC-11). Only the
 * extracted text is kept; the original file is discarded.
 */
import { AppError } from "@/src/lib/errors";

import { MAX_PDF_PAGES, MAX_SOURCE_CHARS, MAX_UNPACKED_BYTES, MAX_UPLOAD_BYTES } from "./schema";
import { zipEntries } from "./zip";

export type Extracted = { text: string; truncated: boolean; pages: number | null };

const KINDS = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".csv": "text",
} as const;
type Kind = (typeof KINDS)[keyof typeof KINDS];

const bad = (message: string) => new AppError("VALIDATION_ERROR", message);
const extension = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();
const startsWith = (bytes: Uint8Array, ascii: string) =>
  [...ascii].every((c, i) => bytes[i] === c.charCodeAt(0));

/** The kind the bytes really are, from the extension and checked against the content. */
function sniff(name: string, bytes: Uint8Array): Kind {
  const kind = KINDS[extension(name) as keyof typeof KINDS];
  if (!kind) throw bad("Upload a PDF, Word (.docx), .txt or .md file");
  if (kind === "pdf" && !startsWith(bytes, "%PDF-")) throw bad("This file isn't a PDF");
  if (kind === "docx") {
    const entries = startsWith(bytes, "PK\x03\x04") ? zipEntries(bytes) : null;
    if (!entries?.some((e) => e.name === "word/document.xml"))
      throw bad("This file isn't a Word document (.docx)");
    const unpacked = entries.reduce((n, e) => n + e.unpackedBytes, 0);
    if (unpacked > MAX_UNPACKED_BYTES || entries.length > 1000)
      throw bad("This Word document unpacks to too much data to read safely");
  }
  return kind;
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PDF_PAGES)
    throw bad(`PDFs are limited to ${MAX_PDF_PAGES} pages; this one has ${pdf.numPages}`);
  const { text } = await extractText(pdf, { mergePages: true });
  return { text, pages: pdf.numPages };
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  // CommonJS package: named export under Node, `default` under some bundlers.
  const extractRawText = mammoth.extractRawText ?? mammoth.default.extractRawText;
  const { value } = await extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

function plainText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw bad("This file isn't plain text");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw bad("Save the file as UTF-8 text and upload it again");
  }
}

/** Whitespace tidied; cut at the source limit with a note the model and the reader both see. */
function fit(raw: string): { text: string; truncated: boolean } {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= MAX_SOURCE_CHARS) return { text, truncated: false };
  const note = `\n\n[Truncated: only the first part of this document was kept (${MAX_SOURCE_CHARS.toLocaleString("en")} characters).]`;
  return { text: text.slice(0, MAX_SOURCE_CHARS - note.length) + note, truncated: true };
}

export async function extractSourceText(name: string, bytes: Uint8Array): Promise<Extracted> {
  if (bytes.length === 0) throw bad("The file is empty");
  if (bytes.length > MAX_UPLOAD_BYTES) throw bad("Files are limited to 10 MB");
  const kind = sniff(name, bytes);
  let raw: string;
  let pages: number | null = null;
  try {
    if (kind === "pdf") ({ text: raw, pages } = await pdfText(bytes));
    else if (kind === "docx") raw = await docxText(bytes);
    else raw = plainText(bytes);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw bad("This file couldn't be read. Is it password-protected or damaged?");
  }
  const fitted = fit(raw);
  if (!fitted.text) throw bad("No text found in this file. Is it a scanned image?");
  return { ...fitted, pages };
}
