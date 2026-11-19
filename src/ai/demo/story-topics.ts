/**
 * Epics, benefits and loose text matching for the demo backlog engines (ADR-011).
 */
// ---------- Topics (epics) and benefits ----------

export type Topic = { title: string; test: RegExp; benefit: string };

export const TOPICS: Topic[] = [
  {
    title: "Accounts & access",
    test: /\b(sign(?:s|ed)?[- ]?(?:in|up|on)|log(?:s|ged)?[- ]?in|accounts?|profiles?|passwords?|roles?|permissions?|kyc|onboard\w*|register\w*|self-register)\b/i,
    benefit: "only the right people can see and change my data",
  },
  {
    title: "Data & retention",
    test: /\b(keep|retain|store|delete)\b.*\b(years?|days?|months?)\b/i,
    benefit: "we meet our record-keeping obligations",
  },
  {
    title: "Notifications",
    test: /\b(notif\w*|alerts?|remind\w*|sms|push|whatsapp|emails? (?:to|confirming))\b/i,
    benefit: "I find out in time without having to keep checking",
  },
  {
    title: "Payments & billing",
    test: /\b(pay|pays|paid|payments?|payouts?|refund\w*|invoices?|billing|checkout|charges?|prices?|pricing|plans?|discount\w*|fees?|cash)\b/i,
    benefit: "I know exactly what I pay and when",
  },
  {
    title: "Booking & scheduling",
    test: /\b(book\w*|appointments?|schedul\w*|calendar|slots?|reschedul\w*)\b/i,
    benefit: "I can get a time that suits me without calling anyone",
  },
  {
    title: "Reporting & insights",
    test: /\b(reports?|exports?|download\w*|dashboards?|charts?|analytics|kpis?|statements?|count of)\b/i,
    benefit: "I can make decisions from up-to-date figures",
  },
  {
    title: "Review & approvals",
    test: /\b(approv\w*|reject\w*|reviews?|reviewing|assign\w*|workflow|escalat\w*|queue|verif\w*|waivers?)\b/i,
    benefit: "requests are decided without chasing anyone",
  },
  {
    title: "Requests & applications",
    test: /\b(submit\w*|requests?|applications?|apply|applies|claims?)\b/i,
    benefit: "I can make my request online and see that it was received",
  },
  {
    title: "Orders & tracking",
    test: /\b(orders?|deliver\w*|track\w*|ship\w*|returns?|parcels?|status|stops?)\b/i,
    benefit: "I always know where things stand",
  },
  {
    title: "Documents & uploads",
    test: /\b(upload\w*|documents?|photos?|files?|attach\w*|scan\w*|certificates?|drawings?)\b/i,
    benefit: "everything needed is in one place",
  },
  {
    title: "Integrations",
    test: /\b(integrat\w*|api|sync\w*|import\w*|sap|erp|crm|soap|batch)\b/i,
    benefit: "nobody has to enter the same data twice",
  },
  {
    title: "Search & browse",
    test: /\b(search\w*|filter\w*|find|browse|sort\w*|lists?|view\w*|see|sees)\b/i,
    benefit: "I can find what I need without scrolling through everything",
  },
];
export const CORE_TOPIC: Topic = {
  title: "Core experience",
  test: /$^/,
  benefit: "I can get it done online, without paperwork",
};
export const QUALITY_TOPIC: Topic = {
  title: "Quality & compliance",
  test: /$^/,
  benefit: "the product meets the standard we agreed",
};

const GENERIC_VERBS = new Set([
  "see",
  "view",
  "get",
  "use",
  "have",
  "be",
  "need",
  "want",
  "make",
  "do",
]);

/**
 * Epic for a story: the lead verb decides first ("track …" → Orders), then the first clause,
 * then the whole text. "Get notified and approve …" is about the approval, not the notification.
 */
export function topicFor(iWant: string, fullText = ""): Topic {
  const phrase = iWant.replace(/\b(?:get|be)\s+notified\s+and\s+/i, "");
  const verb = /^to\s+([a-z-]+)/i.exec(phrase)?.[1]?.toLowerCase();
  const clause = phrase.split(/,|\s+and\s+(?=to\s|get\s|see\s)/)[0] ?? phrase;
  const tries = [verb && !GENERIC_VERBS.has(verb) ? verb : "", clause, `${phrase} ${fullText}`];
  for (const text of tries) {
    const topic = text && TOPICS.find((t) => t.test.test(text));
    if (topic) return topic;
  }
  return CORE_TOPIC;
}

const QUALITY_BENEFITS: [RegExp, string][] = [
  [/\b(fast|speed|load\w*|latency|response|seconds?|performance)\b/i, "I don't lose time waiting"],
  [
    /\b(secur\w*|privacy|private|encrypt\w*|allowed to see|sign\w* in|access)\b/i,
    "my data stays protected",
  ],
  [
    /\b(keep|retain\w*|retention|records?|store|delete)\b/i,
    "we meet our record-keeping obligations",
  ],
  [/\b(available|availability|uptime|24\/7|reliab\w*)\b/i, "I can rely on it whenever I need it"],
  [
    /\b(wcag|accessib\w*|screen reader|keyboard)\b/i,
    "everyone can use it, including people using assistive technology",
  ],
  [/\b(english|spanish|languages?|translat\w*)\b/i, "I can use it in my own language"],
  [/\b(offline|no signal|connection)\b/i, "I can keep working without a connection"],
  [/\b(integrat\w*|api|sync\w*|batch)\b/i, "data stays consistent with our existing systems"],
  [/\b(easy|intuitive|usab\w*|user-friendly)\b/i, "I can get things done without training"],
];

export function qualityBenefit(text: string): string {
  return QUALITY_BENEFITS.find(([re]) => re.test(text))?.[1] ?? QUALITY_TOPIC.benefit;
}

// ---------- Matching ----------

const STOP = new Set(
  "the and for with from that this they their them must should need needs want wants have has into only each every more less than when what where which will about after before until within over under such other also just like can are was our all any get see its not but per day new one two too use way who why how may".split(
    " ",
  ),
);

/** Five-letter stems of content words, for loose matching ("cancellations" ~ "cancel"). */
export function keywordStems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** A business rule rather than a capability: limits, conditions, exceptions. */
export const RULE =
  /\b(only|cannot|can't|must not|mustn't|shouldn't|should not|no more than|at most|at least|within \d|capped|limit\w*|non-refundable|not allowed|over \d|under \d|less than|more than|before \d|after \d|differ\w*|expir\w*)\b/i;
