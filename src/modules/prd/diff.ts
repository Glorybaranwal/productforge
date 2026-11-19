import { PRD_SECTIONS, type PrdContent, type PrdSectionKey } from "./schema";

export type SectionDiff = {
  key: PrdSectionKey;
  title: string;
  changed: boolean;
  /** Plain-text lines of each side, for side-by-side display. */
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
};

/** One line of text per item, so any section can be compared the same way. */
export function sectionLines(content: PrdContent, key: PrdSectionKey): string[] {
  const value = content[key];
  if (typeof value === "string")
    return value
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
  return (value as unknown[]).map((item) => {
    if (typeof item === "string") return item;
    const i = item as Record<string, unknown>;
    if ("goal" in i) return `${i.goal} — metric: ${i.metric}`;
    if ("name" in i) return `${i.name}: ${i.needs}`;
    if ("risk" in i) return `${i.risk} — mitigation: ${i.mitigation}`;
    const codes = (i.requirementCodes as string[]) ?? [];
    return codes.length ? `${i.text} [${codes.join(", ")}]` : String(i.text);
  });
}

/** Section-by-section comparison of two PRD versions (PF-032 side-by-side compare). */
export function diffPrd(before: PrdContent, after: PrdContent): SectionDiff[] {
  return PRD_SECTIONS.map(({ key, title }) => {
    const a = sectionLines(before, key);
    const b = sectionLines(after, key);
    const added = b.filter((line) => !a.includes(line));
    const removed = a.filter((line) => !b.includes(line));
    return {
      key,
      title,
      changed: added.length > 0 || removed.length > 0,
      before: a,
      after: b,
      added,
      removed,
    };
  });
}
