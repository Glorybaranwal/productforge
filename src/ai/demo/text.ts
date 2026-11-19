/** Text helpers for the demo discovery engine. Quotes are always exact substrings of the source. */

export type Segment = {
  /** Exact substring of the source (no list marker, speaker label or trailing punctuation). */
  text: string;
  start: number;
  /** Speaker or section label that preceded the line, e.g. "Meera (Compliance)" or "NFRs". */
  label: string | null;
  /** True when the line was a bullet or numbered item. */
  listItem: boolean;
};

const LIST_MARKER = /^(?:[-*•–]|\d+(?:\.\d+)*[.)]?|\([a-z0-9]\)|\[[^\]]{1,60}\])\s+/i;
// "Rahul (Product): ", "Permit officer: ", "NFRs: " — a short label before a colon at line start
const LABEL = /^([A-Z][A-Za-z0-9 '&/-]{0,40}?(?:\s\([^)]{1,40}\))?):\s+/;
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|approx|incl|no|dr|mr|mrs|ms|st)\.$/i;

export function splitSegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let lineStart = 0;
  for (const rawLine of source.split("\n")) {
    const lineOffset = lineStart;
    lineStart += rawLine.length + 1;

    let offset = lineOffset + (rawLine.length - rawLine.trimStart().length);
    let line = rawLine.trim();
    if (!line) continue;

    let listItem = false;
    const marker = LIST_MARKER.exec(line);
    if (marker) {
      listItem = true;
      offset += marker[0].length;
      line = line.slice(marker[0].length);
    }
    let label: string | null = null;
    const labelMatch = LABEL.exec(line);
    if (labelMatch?.[1] && labelMatch[1].split(" ").length <= 5) {
      label = labelMatch[1];
      offset += labelMatch[0].length;
      line = line.slice(labelMatch[0].length);
    }
    segments.push(...splitSentences(line, offset, label, listItem));
  }
  return segments.filter((s) => s.text.length > 1);
}

function splitSentences(line: string, offset: number, label: string | null, listItem: boolean) {
  const out: Segment[] = [];
  let start = 0;
  const boundary = /([.!?](?=\s+["'(]?[A-Z0-9]|\s*$)|;(?=\s))/g;
  for (let m = boundary.exec(line); m; m = boundary.exec(line)) {
    const end = m.index;
    const candidate = line.slice(start, end + 1);
    if (m[1] === "." && ABBREVIATIONS.test(candidate)) continue;
    push(out, line, start, end + (m[1] === "?" ? 1 : 0), offset, label, listItem);
    start = end + 1;
  }
  push(out, line, start, line.length, offset, label, listItem);
  return out;
}

function push(
  out: Segment[],
  line: string,
  from: number,
  to: number,
  offset: number,
  label: string | null,
  listItem: boolean,
) {
  const raw = line.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim().replace(/[.;:,]+$/, "");
  if (text) out.push({ text, start: offset + from + lead, label, listItem });
}

export { containsQuote, contentWords, normalize } from "@/src/lib/text";

export function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function unique<T>(items: T[], key: (item: T) => string = (i) => String(i)): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

const SUBJECT_PREFIX =
  /^(?:the\s+)?[\w-]+(?:\s[\w-]+){0,2}\s+(?:can|could|should be able to|must be able to|should|must|need to|needs to|want to|wants to|will|get|gets)\s+/i;

/** "Customers can filter transactions" → "filter transactions". */
export function capability(text: string): string {
  const stripped = text.replace(SUBJECT_PREFIX, "");
  const phrase = stripped === text ? text : stripped;
  return phrase.replace(/[.!]+$/, "").trim();
}
