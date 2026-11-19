import type { Conflict } from "@/src/modules/requirements/schema";

import type { Segment } from "./text";

type Located = Segment & { sourceText: string };

const short = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Two statements that can't both be true. Each side must come from a different sentence. */
const PAIRS: { a: RegExp; b: RegExp; question: string; topic: string }[] = [
  {
    a: /\b(fully offline|works? (?:fully )?offline|no signal)\b/i,
    b: /\b(sync\w* instantly|instantly|the second|in real[- ]time)\b/i,
    question: "How soon after reconnecting must data sync, given there's no signal on site?",
    topic: "Sync timing",
  },
  {
    a: /\b(fully offline|works? offline|offline)\b/i,
    b: /\b(never store data on the device|no data (?:is )?stored on the device)\b/i,
    question: "Is encrypted on-device storage acceptable so the app can work offline?",
    topic: "On-device storage",
  },
  {
    a: /\b\d+ (?:high-res )?photos\b/i,
    b: /\bnever store data on the device\b/i,
    question: "Where are photos kept before upload if nothing may be stored on the device?",
    topic: "Photo storage",
  },
  {
    a: /\bunlimited\b/i,
    b: /\b(capped at \d+|limited to \d+|max(?:imum)? of \d+)\b/i,
    question: "Which limit applies — unlimited or capped?",
    topic: "Usage limit",
  },
  {
    a: /\b(pay online only|online only|no cash)\b/i,
    b: /\b(cash on delivery|pay cash)\b/i,
    question: "Which payment methods are accepted — online only, or cash on delivery too?",
    topic: "Payment methods",
  },
  {
    a: /\b(our own staff deliver|own staff deliver|our own drivers)\b/i,
    b: /\b(delivery apps|third[- ]party drivers|their drivers)\b/i,
    question: "Who handles delivery — our staff, delivery-app drivers, or both?",
    topic: "Delivery model",
  },
  {
    a: /\b(prorated refund|cancel anytime)\b/i,
    b: /\bnon-refundable\b/i,
    question: "What is the refund policy when a customer cancels?",
    topic: "Refund policy",
  },
  {
    a: /\b(policy lookup|live lookup|real[- ]time)\b/i,
    b: /\b(nightly batch|batch only)\b/i,
    question:
      "How will data be current at the time of use if the source system updates only nightly?",
    topic: "Data freshness",
  },
];

function hoursOf(text: string): number[] {
  const hours: number[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi)) {
    const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
    hours.push(h + Number(m[2] ?? 0) / 60);
  }
  return hours;
}

function agesOf(text: string): number[] {
  const ages = [...text.matchAll(/\b(\d{2})\s?(?:\+|and older|and over|years and older)/gi)].map(
    (m) => Number(m[1]),
  );
  if (/\badults?\b/i.test(text)) ages.push(18);
  return ages;
}

function daysOf(text: string): number[] {
  const unit: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  return [...text.matchAll(/\b(\d+)\s?(day|week|month|year)s?\b/gi)].map(
    (m) => Number(m[1]) * unit[m[2]!.toLowerCase()]!,
  );
}

function percentsOf(text: string): number[] {
  return [...text.matchAll(/\b(\d{1,2})%/g)].map((m) => Number(m[1]));
}

/** Same dimension, different values in two sentences. */
const NUMERIC: {
  applies: RegExp;
  values: (t: string) => number[];
  describe: (a: Located, b: Located) => string;
  question: string;
  topic: string;
}[] = [
  {
    applies: /\b(discount|off)\b/i,
    values: percentsOf,
    describe: (a, b) => `${percentsOf(a.text)[0]}% discount vs ${percentsOf(b.text)[0]}% discount`,
    question: "Which discount applies?",
    topic: "Annual discount",
  },
  {
    applies: /\b(older|over|adults?|\d{2}\+)\b/i,
    values: agesOf,
    describe: (a, b) => `minimum age ${agesOf(a.text)[0]} vs ${agesOf(b.text)[0]}`,
    question: "Which minimum age applies?",
    topic: "Minimum age",
  },
  {
    applies: /\b(store|stored|keep|kept|retain\w*|delete\w*)\b/i,
    values: daysOf,
    describe: (a, b) => `"${short(a.text, 50)}" vs "${short(b.text, 50)}"`,
    question: "How long must this data be kept, and when must it be deleted?",
    topic: "Data retention",
  },
  {
    applies: /\b(open|until|close\w*|last orders)\b/i,
    values: hoursOf,
    describe: (a, b) => `"${short(a.text, 50)}" vs "${short(b.text, 50)}"`,
    question: "What are the actual hours — when do orders open and close?",
    topic: "Opening hours",
  },
];

/** Short label for a conflict question, used when its answer becomes a requirement. */
export function conflictTopic(question: string): string | undefined {
  if (/minute target include/.test(question)) return "Time target";
  return [...PAIRS, ...NUMERIC].find((r) => r.question === question)?.topic;
}

export function detectConflicts(segments: Located[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const add = (a: Located, b: Located, description: string, question: string) => {
    if (conflicts.some((c) => c.question === question)) return;
    conflicts.push({ description, quotes: [a.text, b.text], question });
  };

  for (const rule of PAIRS) {
    const a = segments.find((s) => rule.a.test(s.text));
    const b = segments.find((s) => s !== a && rule.b.test(s.text));
    if (a && b) add(a, b, `"${short(a.text)}" vs "${short(b.text)}"`, rule.question);
  }

  // Time budget: "under 5 minutes" vs "10-15 minutes"
  const under = segments.find((s) => /\bunder (\d+) minutes?\b/i.test(s.text));
  const range = segments.find(
    (s) => s !== under && /\b(\d+)\s?[-–]\s?(\d+) minutes\b/i.test(s.text),
  );
  if (under && range) {
    const limit = Number(/\bunder (\d+) minutes?\b/i.exec(under.text)![1]);
    const low = Number(/\b(\d+)\s?[-–]\s?(\d+) minutes\b/i.exec(range.text)![1]);
    if (low > limit) {
      add(
        under,
        range,
        `done in under ${limit} minutes vs a step taking ${low}+ minutes`,
        `Does the ${limit}-minute target include the ${low}+ minute step, or should one of them change?`,
      );
    }
  }

  for (const rule of NUMERIC) {
    const hits = segments
      .filter((s) => rule.applies.test(s.text) && rule.values(s.text).length > 0)
      .map((s) => ({ s, v: Math.max(...rule.values(s.text)) }));
    const first = hits[0];
    const other = first && hits.find((h) => h.s !== first.s && h.v !== first.v);
    if (first && other) add(first.s, other.s, rule.describe(first.s, other.s), rule.question);
  }
  return conflicts;
}
