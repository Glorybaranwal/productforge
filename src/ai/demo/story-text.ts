/**
 * Text heuristics for the demo backlog engines (ADR-011): who a requirement is for, what they
 * want, why, and which epic it belongs to. Deterministic and conservative — anything the source
 * doesn't say is marked as inferred by the callers.
 */
import { ACTOR_PATTERNS, LIST_VERBS } from "./lexicon";
import { capitalize, lowerFirst } from "./text";

// ---------- Actors ----------

const ROLE_NAMES: Record<string, string> = {
  staff: "staff member",
  "front-desk staff": "front-desk staff member",
  warehouse: "warehouse worker",
  procurement: "procurement officer",
  finance: "finance team member",
  "finance team": "finance team member",
  hr: "HR manager",
  legal: "legal team member",
  leadership: "leader",
  "customer support": "support agent",
  "fraud team": "fraud analyst",
  "sales team": "sales rep",
  "sales teams": "sales rep",
  "small businesses": "small business owner",
  regulars: "regular customer",
  "garage partners": "garage partner",
};

/** "Customers" → "customer", "Front-desk staff" → "front-desk staff member". */
export function singularRole(actor: string): string {
  const key = actor.trim().toLowerCase();
  if (ROLE_NAMES[key]) return ROLE_NAMES[key];
  if (/(ss|us)$/.test(key)) return key;
  if (/ies$/.test(key)) return key.replace(/ies$/, "y");
  return key.replace(/s$/, "");
}

const LEAD =
  /^(?:(?:the|our|own|all|every|each|field|new|free|existing|registered|internal|external)\s+){0,2}/i;

/** Longest actor name at index 0 of `text` ("Customer support" beats "Customer"). */
function actorAt(text: string): string | null {
  let best: string | null = null;
  for (const pattern of ACTOR_PATTERNS) {
    const m = new RegExp(pattern.source, "i").exec(text);
    if (m && m.index === 0 && (!best || m[0].length > best.length)) best = m[0];
  }
  return best;
}

/** Finds an actor at the very start of `text`; returns it and the rest of the sentence. */
function leadingActor(text: string): { actor: string; rest: string } | null {
  const lead = LEAD.exec(text)?.[0] ?? "";
  const body = text.slice(lead.length);
  const first = actorAt(body);
  if (!first) return null;
  let actor = singularRole(first);
  let rest = body.slice(first.length).trimStart();
  // "Residents and contractors apply…" → "resident or contractor"
  const joiner = /^(?:and|or)\s+/i.exec(rest);
  const second = joiner && actorAt(rest.slice(joiner[0].length));
  if (joiner && second) {
    actor = `${actor} or ${singularRole(second)}`;
    rest = rest.slice(joiner[0].length + second.length).trimStart();
  }
  return { actor, rest };
}

// ---------- Verbs ----------

const EXTRA_VERBS =
  "get need want review receive see approve verify file deliver order use earn sign log apply raise check list browse return refund cancel reschedule request remind suspend sync show close register self-register complete launch store keep mark take enter pick".split(
    " ",
  );
const VERBS = new Set([...LIST_VERBS, ...EXTRA_VERBS]);

/** "reviews" → "review", "approves" → "approve", "reaches" → "reach". */
function stem(word: string): string | null {
  const w = word.toLowerCase();
  if (!w.endsWith("s") || w.endsWith("ss")) return null;
  const candidates = [w.slice(0, -1), w.replace(/es$/, ""), w.replace(/ies$/, "y")];
  return candidates.find((c) => VERBS.has(c)) ?? null;
}

/** Turns third-person verbs after a start, "and", "or" or comma into base forms. */
function baseVerbs(phrase: string): string {
  return phrase.replace(
    /(^|\b(?:and|or)\s+|,\s*)([A-Za-z]+s)\b/g,
    (all, before: string, word: string) => {
      const base = stem(word);
      return base ? `${before}${base}` : all;
    },
  );
}

const MODAL =
  /^(?:can|could|should be able to|must be able to|need to be able to|are able to|is able to|should|must|shall|will|need to|needs to|want to|wants to|have to|has to|get to)\s+/i;

/** "They" → "them", "The reports" → "the reports" (the subject of "I want X to …"). */
function objectCase(subject: string): string {
  const s = lowerFirst(subject.trim());
  return ({ they: "them", he: "him", she: "her", we: "us" } as Record<string, string>)[s] ?? s;
}

/** Things a story should not say in the first person: "their order" → "my order". */
const firstPerson = (s: string) => s.replace(/\btheir\b/g, "my");

export type StoryPhrase = {
  /** "customer", or null when the requirement names no one. */
  actor: string | null;
  /** What follows "I want": "to filter transactions by date" / "the app to work offline". */
  iWant: string;
  /** A purpose stated in the source ("so they upgrade"), if any. */
  purpose: string | null;
  /** The requirement speaks for the business ("we", "our") rather than a user. */
  business: boolean;
  /** Led by an actor and a verb: a capability, not a rule. */
  actorLed: boolean;
};

// "…so that X", "…so they upgrade" (not "so we must…"), "…in order to X"
const PURPOSE =
  /[,;]?\s+(so that|in order to|so(?=\s+(?:they|we|i|it|users|customers)\b(?!\s+(?:must|have to|need))))\s+(.+)$/i;

export function storyPhrase(rawText: string): StoryPhrase {
  let text = rawText.trim().replace(/[.!]+$/, "");
  let purpose: string | null = null;
  const p = PURPOSE.exec(text);
  if (p?.[1] && p[2]) {
    purpose = p[1].toLowerCase() === "in order to" ? `I can ${p[2]}` : p[2];
    text = text.slice(0, p.index);
  }
  // "If nobody is home, the driver marks it failed…" → the action, with the condition after it
  const cond = /^(if|when|once|after|before)\s+([^,]{3,80}),\s+(.{8,})$/i.exec(text);
  if (cond?.[1] && cond[2] && cond[3]) {
    const inner = storyPhrase(cond[3]);
    return {
      ...inner,
      iWant: `${inner.iWant} ${cond[1].toLowerCase()} ${cond[2]}`,
      purpose: purpose ?? inner.purpose,
    };
  }
  const business = /^(?:we|our)\b/i.test(text);
  const future = /^we(?:'ll| will| are going to)\s+(.+)$/i.exec(text);
  if (future?.[1])
    return { actor: null, iWant: `to ${future[1]}`, purpose, business, actorLed: false };

  // "We need patients to book…", "We want customers to track…"
  const wanted = /^(?:we\s+)?(?:need|want)s?\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (wanted?.[1] && wanted[2]) {
    const who = leadingActor(wanted[1]);
    if (who && !who.rest) {
      return {
        actor: who.actor,
        iWant: `to ${firstPerson(baseVerbs(wanted[2]))}`,
        purpose,
        business: false,
        actorLed: true,
      };
    }
  }

  const led = leadingActor(text);
  if (led) {
    let rest = led.rest;
    const modal = MODAL.exec(rest);
    if (modal) rest = rest.slice(modal[0].length);
    // "need a daily schedule view … and must be able to block time off"
    const needNoun = /^(?:needs?|wants?)\s+(?!to\b)/i.exec(rest);
    if (needNoun) rest = rest.slice(needNoun[0].length);
    rest = rest.replace(/\s+and\s+(?:must|should|can|needs? to)\s+(?:be able to\s+)?/i, " and to ");
    const first = rest.split(/\s+/)[0] ?? "";
    const verb =
      VERBS.has(first.toLowerCase()) || stem(first) !== null || /^(get|gets)$/i.test(first);
    if (verb || modal || needNoun) {
      const phrase = firstPerson(baseVerbs(rest));
      return {
        actor: led.actor,
        iWant: needNoun || /^(?:to\s|a\s|an\s|the\s|my\s)/i.test(phrase) ? phrase : `to ${phrase}`,
        purpose,
        business: false,
        actorLed: true,
      };
    }
  }

  // No actor: "It should help…", "Must integrate with…", "All data must sync…", "Certificates have expiry dates"
  const it =
    /^(?:it|this|the system|the product)\s+(?:should|must|needs to|has to|will|shall|can)\s+(.+)$/i.exec(
      text,
    );
  if (it?.[1]) return { actor: null, iWant: `it to ${it[1]}`, purpose, business, actorLed: false };
  const bare =
    /^(?:must|should|needs? to|has to|have to|we (?:only |also |still )?(?:must|should|need to|have to|will))\s+(.+)$/i.exec(
      text,
    );
  if (bare?.[1]) {
    const iWant = business ? `to ${bare[1]}` : `it to ${bare[1]}`;
    return { actor: null, iWant, purpose, business, actorLed: false };
  }
  const firstWord = text.split(/\s+/)[0]!.toLowerCase();
  if (VERBS.has(firstWord) && !/^(?:need|want)$/.test(firstWord)) {
    return { actor: null, iWant: `it to ${lowerFirst(text)}`, purpose, business, actorLed: false };
  }
  const need = /^(?:we\s+)?(?:need|want)s?\s+(.+)$/i.exec(text);
  if (need?.[1]) return { actor: null, iWant: need[1], purpose, business, actorLed: false };
  const subjModal =
    /^(.+?)\s+(?:must|should|shall|will|can|need to|needs to|has to|have to)\s+(?:be able to\s+)?(.+)$/i.exec(
      text,
    );
  if (subjModal?.[1] && subjModal[2] && subjModal[1].split(/\s+/).length <= 6) {
    return {
      actor: null,
      iWant: `${objectCase(subjModal[1])} to ${subjModal[2]}`,
      purpose,
      business,
      actorLed: false,
    };
  }
  const subjVerb = /^(.+?)\s+(has|have|is|are|gets?|goes|go)\s+(.+)$/i.exec(text);
  if (subjVerb?.[1] && subjVerb[2] && subjVerb[3] && subjVerb[1].split(/\s+/).length <= 5) {
    const base =
      ({ has: "have", is: "be", are: "be", gets: "get", goes: "go" } as Record<string, string>)[
        subjVerb[2].toLowerCase()
      ] ?? subjVerb[2].toLowerCase();
    return {
      actor: null,
      iWant: `${objectCase(subjVerb[1])} to ${base} ${subjVerb[3]}`,
      purpose,
      business,
      actorLed: false,
    };
  }
  if (/^[A-Z]{2,}/.test(text) && text.split(/\s+/).length <= 6) {
    return { actor: null, iWant: `it to meet ${text}`, purpose, business, actorLed: false };
  }
  return {
    actor: null,
    iWant: `it to ensure that ${lowerFirst(text)}`,
    purpose,
    business,
    actorLed: false,
  };
}

/** "to track my delivery live on a map, see an ETA…" → "Track delivery live on a map". */
export function storyTitle(iWant: string): string {
  const core = iWant
    .replace(/^(?:it|the product)\s+to\s+(?:ensure\s+that\s+)?/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\bmy\s+/gi, "");
  const clause = core
    .split(/[:;(—–]|\s-\s|,\s+and\s/)[0]!
    .trim()
    .replace(/,$/, "");
  const words = clause.split(/\s+/);
  let title = "";
  for (const w of words) {
    if ((title + " " + w).trim().length > 60) break;
    title = `${title} ${w}`.trim();
  }
  if (title.length < clause.length)
    title = title.replace(/\s+(?:and|or|the|a|an|to|of|for|with|in|on|by)$/i, "") + "…";
  return capitalize(title || clause.slice(0, 60));
}

/** First verb of a "to …" phrase, lower-case; null for noun phrases. */
export function leadVerb(iWant: string): string | null {
  const m = /^to\s+([a-z-]+)/i.exec(iWant.trim());
  return m?.[1]?.toLowerCase() ?? null;
}
