/**
 * Demo impact analyst (ADR-011, PF-053): compares the old and new wording, finds the words and
 * numbers that change, and rates every item the rules listed by whether it quotes them.
 */
import type { ImpactInput } from "@/src/ai/schemas/impact";
import type { CandidateStory } from "@/src/modules/impact/candidates";
import type { ImpactItem, ImpactOutput, Severity } from "@/src/modules/impact/schema";

const STOP = new Set(
  "a an and are as at be by can could for from has have in into is it its may must not of on or our should so than that the their them then there these they this to under up was we when which while who will with within without would you your all any each every only also more most less least per via until unless etc user users customer customers system able allow allows".split(
    " ",
  ),
);

/** "90 days", "2 seconds", "99.9%", "5" — numbers with the unit that follows them. */
const QUANTITY =
  /\b\d+(?:[.,]\d+)?(?:\s?%|\s?(?:ms|seconds?|secs?|minutes?|mins?|hours?|days?|weeks?|months?|years?|times|items|records|users|mb|gb|kb))?/gi;

const quantities = (t: string) => [
  ...new Set((t.match(QUANTITY) ?? []).map((q) => q.toLowerCase().replace(/\s+/, " "))),
];
const contentWords = (t: string) => [
  ...new Set((t.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w))),
];

export function changedTerms(
  before: string,
  after: string,
): { removed: string[]; added: string[] } {
  const qb = quantities(before);
  const qa = quantities(after);
  const wb = contentWords(before);
  const wa = new Set(contentWords(after));
  const wbSet = new Set(wb);
  // "90 days" also matches "90-day" through its bare number, unless the new wording keeps it.
  const number = (q: string) => q.match(/^\d+(?:[.,]\d+)?/)?.[0] ?? q;
  const gone = qb.filter((q) => !qa.includes(q));
  const fresh = qa.filter((q) => !qb.includes(q));
  const kept = new Set(qa.map(number));
  const goneBare = [...new Set(gone.map(number))].filter((n) => !kept.has(n) && !gone.includes(n));
  return {
    removed: [...gone, ...goneBare, ...wb.filter((w) => !wa.has(w))],
    added: [...fresh, ...[...wa].filter((w) => !wbSet.has(w))],
  };
}

/** Lower-case term → how the requirement writes it ("csv" → "CSV"). */
const surface = (text: string) => {
  const m = new Map<string, string>();
  for (const w of text.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? [])
    if (!m.has(w.toLowerCase())) m.set(w.toLowerCase(), w);
  return m;
};

/** Numbers first, then acronyms (CSV, PDF), then longer, more specific words. */
const byWeight = (shown: Map<string, string>) => (a: string, b: string) => {
  const w = (t: string) =>
    (/\d/.test(t) ? 300 : /^[A-Z0-9]{2,}$/.test(shown.get(t) ?? "") ? 200 : 0) + t.length;
  return w(b) - w(a);
};

const mentions = (text: string, terms: string[]) => {
  const lower = text.toLowerCase();
  return terms.filter((t) =>
    new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower),
  );
};
const cap = (s: string) => (s.length > 400 ? `${s.slice(0, 397)}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function storyNote(s: CandidateStory): string {
  const parts: string[] = [];
  if (s.status === "APPROVED")
    parts.push(`Version ${s.version} is approved, so the fix is a new version.`);
  if (s.sprint) parts.push(`It's planned in sprint ${s.sprint}.`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function runDemoImpact(input: ImpactInput): ImpactOutput {
  const { change, candidates } = input;
  const code = change.code ?? "the new requirement";
  const items: ImpactItem[] = [];
  const add = (item: ImpactItem) => items.push({ ...item, explanation: cap(item.explanation) });

  if (change.kind === "add") {
    if (candidates.prd)
      add({
        ref: "PRD",
        kind: "prd",
        severity: "medium",
        explanation: `PRD v${candidates.prd.version} doesn't cover ${code}. Start version ${candidates.prd.version + 1} so Gate 2 includes it before the backlog generates its story.`,
      });
    return {
      summary: `Adds ${change.after?.type === "non_functional" ? "a non-functional" : "a functional"} requirement. Nothing is built on it yet: after approval, ${candidates.prd ? "start a new PRD version, then " : ""}generate its story in the backlog.`,
      items,
    };
  }

  const before = change.before?.text ?? "";
  const after = change.after?.text ?? "";
  const { removed, added } =
    change.kind === "modify" ? changedTerms(before, after) : { removed: [], added: [] };
  const keyTerms = contentWords(before).slice(0, 8);
  const evidenceOnly = change.kind === "modify" && removed.length === 0 && added.length === 0;
  const shown = surface(`${before} ${after}`);
  const old = [...removed].sort(byWeight(shown));
  const now = [...added].sort(byWeight(shown));
  // "90 days" already says "90": quote each idea once.
  const quote = (terms: string[]) =>
    terms
      .filter((t, i) => !terms.slice(0, i).some((u) => u.includes(t)))
      .slice(0, 2)
      .map((t) => `"${shown.get(t) ?? t}"`)
      .join(" and ");
  const swap = old.length && now.length ? `; the requirement now says ${quote(now)}` : "";

  if (candidates.prd) {
    const hit = candidates.prd.lines.find((l) => mentions(l, old).length);
    const v = candidates.prd.version;
    add({
      ref: "PRD",
      kind: "prd",
      severity: change.kind === "withdraw" || hit ? "high" : "medium",
      explanation:
        change.kind === "withdraw"
          ? `PRD v${v} still lists ${code} in ${plural(candidates.prd.lines.length, "line")}. Remove it in version ${v + 1}.`
          : hit
            ? `PRD v${v} still says ${quote(mentions(hit, old))}${swap}. Start version ${v + 1} with the new wording.`
            : `PRD v${v} cites ${code}. Start version ${v + 1} so it matches the new wording.`,
    });
  }

  for (const s of candidates.stories) {
    let severity: Severity;
    let explanation: string;
    const flaggedCriteria: string[] = [];
    for (const ac of s.criteria) {
      const text = `${ac.given} ${ac.when} ${ac.then}`;
      if (change.kind === "withdraw") {
        const overlap = mentions(text, keyTerms);
        if (s.otherRequirements.length && overlap.length >= 2) {
          flaggedCriteria.push(ac.ref);
          add({
            ref: ac.ref,
            kind: "criterion",
            severity: "high",
            explanation: `Tests ${code} (${quote(overlap)}), which is withdrawn. Remove it from the new version.`,
          });
        }
        continue;
      }
      const hits = mentions(text, old);
      if (hits.length) {
        flaggedCriteria.push(ac.ref);
        add({
          ref: ac.ref,
          kind: "criterion",
          severity: "high",
          explanation: `Still checks ${quote(hits)}${swap}.`,
        });
      }
    }
    for (const t of s.tasks) {
      const hits = change.kind === "modify" ? mentions(t.title, old) : [];
      if (hits.length)
        add({
          ref: t.ref,
          kind: "task",
          severity: "medium",
          explanation: `Built around ${quote(hits)}${swap}. Re-estimate it after the change.`,
        });
    }
    const storyHits = mentions(`${s.title} ${s.sentence}`, old);
    if (change.kind === "withdraw") {
      severity = s.otherRequirements.length ? "medium" : "high";
      explanation = s.otherRequirements.length
        ? `Also covers ${s.otherRequirements.join(", ")}: drop the link to ${code}${flaggedCriteria.length ? ` and ${plural(flaggedCriteria.length, "criterion", "criteria")} that only test it` : ""}.`
        : `Exists only for ${code}. Reject it, or link it to another requirement.`;
    } else if (evidenceOnly) {
      severity = "low";
      explanation = `${code}'s wording is the same; its evidence changes from ${change.before?.evidence.toLowerCase().replace("_", " ")} to ${change.after?.evidence.toLowerCase().replace("_", " ")}. Re-read the story; no edit may be needed.`;
    } else if (storyHits.length) {
      severity = "high";
      explanation = `Written around ${quote(storyHits)}${swap}.`;
    } else if (flaggedCriteria.length) {
      severity = "high";
      explanation = `${plural(flaggedCriteria.length, "criterion", "criteria")} (${flaggedCriteria.slice(0, 3).join(", ")}) ${flaggedCriteria.length === 1 ? "tests" : "test"} the old wording.`;
    } else {
      severity = "low";
      explanation = `Links ${code}, but nothing in it quotes the words that change. Re-read it against the new wording.`;
    }
    add({ ref: s.code, kind: "story", severity, explanation: explanation + storyNote(s) });
  }

  const stories = candidates.stories.length;
  const planned = candidates.stories.filter((s) => s.sprint).length;
  const high = items.filter((i) => i.severity === "high").length;
  const what =
    change.kind === "withdraw"
      ? `Withdraws ${code}.`
      : evidenceOnly
        ? `${code} keeps its wording; only its evidence changes.`
        : `${code} changes${old.length && now.length ? ` ${quote(old.slice(0, 1))} to ${quote(now.slice(0, 1))}` : " its wording"}.`;
  const reach = stories
    ? `${plural(stories, "story", "stories")} link${stories === 1 ? "s" : ""} it${planned ? ` (${planned} already in a sprint)` : ""}; ${plural(high, "item")} must change.`
    : "No story links it yet.";
  const first = candidates.prd
    ? "Start a new PRD version first, then update the stories."
    : stories
      ? "Update the high-impact stories first."
      : "Only the requirement changes.";
  return { summary: `${what} ${reach} ${first}`, items };
}
