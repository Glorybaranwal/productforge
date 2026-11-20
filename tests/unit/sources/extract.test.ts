import { describe, expect, it } from "vitest";

import { extractSourceText } from "@/src/modules/sources/extract";
import { MAX_SOURCE_CHARS } from "@/src/modules/sources/schema";
import { zipEntries } from "@/src/modules/sources/zip";
import { makeDocx, makePdf, makeZip } from "@/tests/helpers/documents";

const enc = (s: string) => new TextEncoder().encode(s);

describe("document upload: extraction (PF-023)", () => {
  it("reads the text of a PDF, page by page", async () => {
    const out = await extractSourceText(
      "brief.pdf",
      makePdf(["Customers can view transactions", "Exports as CSV"]),
    );
    expect(out).toMatchObject({ pages: 2, truncated: false });
    expect(out.text).toContain("Customers can view transactions");
    expect(out.text).toContain("Exports as CSV");
  });

  it("reads the text of a Word document", async () => {
    const out = await extractSourceText(
      "notes.docx",
      makeDocx(["Support agents need 90 days", "Keep records 7 years"]),
    );
    expect(out.text).toContain("Support agents need 90 days");
    expect(out.text).toContain("Keep records 7 years");
    expect(out.pages).toBeNull();
  });

  it("reads UTF-8 text and Markdown as they are", async () => {
    expect((await extractSourceText("a.md", enc("# Notes\n\nCafé ✓"))).text).toBe(
      "# Notes\n\nCafé ✓",
    );
  });

  it("cuts long text at the source limit, with a note", async () => {
    const out = await extractSourceText("long.txt", enc("word ".repeat(20_000)));
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS);
    expect(out.text).toMatch(/\[Truncated: .*\]$/);
  });
});

describe("document upload: what's refused (SEC-11)", () => {
  const refused = async (name: string, bytes: Uint8Array) => {
    let message = "";
    try {
      await extractSourceText(name, bytes);
    } catch (err) {
      message = (err as { code?: string; message: string }).code + ": " + (err as Error).message;
    }
    return message;
  };

  it("refuses a file whose content doesn't match its extension", async () => {
    expect(await refused("invoice.pdf", enc("<html>not a pdf</html>"))).toMatch(
      /VALIDATION_ERROR: .*isn't a PDF/,
    );
    expect(await refused("notes.docx", makePdf(["x"]))).toMatch(/isn't a Word document/);
    expect(await refused("binary.txt", new Uint8Array([72, 0, 105]))).toMatch(/isn't plain text/);
  });

  it("refuses other file types, empty files and files over 10 MB", async () => {
    expect(await refused("tool.exe", enc("MZ"))).toMatch(/Upload a PDF, Word/);
    expect(await refused("empty.txt", new Uint8Array())).toMatch(/empty/);
    expect(await refused("big.txt", new Uint8Array(10 * 1024 * 1024 + 1).fill(65))).toMatch(
      /10 MB/,
    );
  });

  it("refuses PDFs over 50 pages", async () => {
    const pages = Array.from({ length: 51 }, (_, i) => `Page ${i + 1}`);
    expect(await refused("long.pdf", makePdf(pages))).toMatch(
      /limited to 50 pages; this one has 51/,
    );
  });

  it("refuses a Word file that claims to unpack to a huge size (zip bomb)", async () => {
    const bomb = makeDocx(["x"], { "word/document.xml": 4_000_000_000 });
    expect(await refused("bomb.docx", bomb)).toMatch(/unpacks to too much data/);
  });

  it("reads zip directories without unpacking", () => {
    expect(zipEntries(makeZip({ "a.txt": "hello" }))).toEqual([
      { name: "a.txt", unpackedBytes: 5 },
    ]);
    expect(zipEntries(enc("not a zip at all, just text"))).toBeNull();
  });
});
