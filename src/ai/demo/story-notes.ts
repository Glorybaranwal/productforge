/** Reviewer notes the demo story engine can follow (ADR-011); anything else needs a real model. */
import type { StoryOutput } from "@/src/ai/schemas/backlog";
import { PRIORITIES, type Priority } from "@/src/modules/stories/schema";

import { capitalize } from "./text";

type Story = StoryOutput["stories"][number];

const PERSONA_NOTE = [
  /\bpersona\b\s*(?:should be|to|is|=|:)?\s*(?:an?\s+|the\s+)?([a-z][\w -]{1,30}?)\s*(?=[,.;!]|$|\b(?:instead|rather|not)\b)/i,
  /\bas an?\s+([a-z][\w -]{1,30}?)\s*(?=[,.;!]|$|\b(?:instead|rather|not|so|and|who)\b)/i,
  /\b(?:it'?s|this is) for (?:an?\s+|the\s+)?([a-z][\w -]{1,30}?)\s*(?=[,.;!]|$|\b(?:instead|rather|not)\b)/i,
];

/**
 * Applies the instructions a demo engine can follow — persona, priority, "so that" and title —
 * and says plainly when a note needs a real model.
 */
export function applyNote(story: Story, note: string, lead: string): Story {
  const next = { ...story };
  const applied: string[] = [];
  for (const re of PERSONA_NOTE) {
    const m = re.exec(note);
    if (m?.[1]) {
      next.asA = m[1].trim().toLowerCase();
      applied.push(`persona → ${next.asA}`);
      break;
    }
  }
  const priority =
    /\b(must|should|could)[- ]have\b/i.exec(note)?.[1] ??
    /\bpriority\b[^.]*?\b(must|should|could|high|medium|low)\b/i.exec(note)?.[1];
  const shift = /\b(lower|raise|increase|decrease|reduce)\b[^.]*\bpriority\b/i.exec(note)?.[1];
  if (priority) {
    const map: Record<string, Priority> = { high: "must", medium: "should", low: "could" };
    next.priority = (map[priority.toLowerCase()] ?? priority.toLowerCase()) as Priority;
    applied.push(`priority → ${next.priority}`);
  } else if (shift) {
    const i = PRIORITIES.indexOf(next.priority) + (/lower|decrease|reduce/i.test(shift) ? 1 : -1);
    next.priority = PRIORITIES[Math.min(Math.max(i, 0), PRIORITIES.length - 1)]!;
    applied.push(`priority → ${next.priority}`);
  }
  const soThat = /\bso that\s+([^.;]+)/i.exec(note)?.[1];
  if (soThat) {
    next.soThat = soThat.trim();
    applied.push("benefit rewritten");
  }
  const title = /\btitle\b\s*(?:should be|to|:|=)\s*["“]?([^"”.;]+)["”]?/i.exec(note)?.[1];
  if (title) {
    next.title = capitalize(title.trim());
    applied.push("title rewritten");
  }
  const caseNote = /\b(edge|negative)\s+case\b/i.test(note);
  const pointsNote = /\b\d{1,2}\s*(?:story\s+)?points?\b/i.test(note);
  const quoted = `“${note.trim().replace(/\s+/g, " ").slice(0, 300)}”`;
  const summary = applied.length
    ? `Applied: ${applied.join(", ")}.`
    : caseNote || pointsNote
      ? "Applied to the criteria and estimates."
      : "The demo engine applies persona, priority, “so that”, title, extra cases and points; other notes need a connected model.";
  next.rationale = `${lead}: ${quoted}. ${summary} ${story.rationale}`.slice(0, 500);
  return next;
}
