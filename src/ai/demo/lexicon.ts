/** Word lists and rules for the demo discovery engine. Deterministic by design (ADR-011). */

/** Vague terms → a measurable follow-up question. Longest phrases first so they win over parts. */
export const AMBIGUOUS_TERMS: [term: string, question: string][] = [
  [
    "integrate with everything",
    "Which integrations are required for the first release, in priority order?",
  ],
  [
    "scales to enterprise",
    "What scale must it support — number of users, records and requests per second?",
  ],
  ["how the business is doing", "Which 3–5 measures define how the business is doing?"],
  [
    "how students are doing",
    "Which progress measures should teachers see (scores, completion, time spent)?",
  ],
  [
    "available 24/7",
    "What uptime target applies (e.g. 99.9%) and which maintenance windows are acceptable?",
  ],
  ["prioritised by severity", "How is severity defined and scored for prioritisation?"],
  ["the right people", "Who exactly should receive it — named roles or a distribution list?"],
  ["important KPIs", "Which KPIs are most important, and how is each calculated?"],
  ["real-time-ish", "How fresh must the data be — seconds, minutes or hourly?"],
  ["real-time", "What latency counts as real-time here — under 1 second, or under 1 minute?"],
  ["mobile friendly", "Does mobile friendly mean a responsive web app or native iOS/Android apps?"],
  [
    "smooth payments",
    "Which payment methods, payout timing and failure handling make payments smooth?",
  ],
  ["good matching", "Which criteria define a good match (skills, location, price, availability)?"],
  ["at a glance", "What must someone understand within a few seconds of opening it?"],
  [
    "easy to use",
    "How will we judge easy to use — e.g. a new user completes the main task in under 2 minutes?",
  ],
  ["really fast", "What response time counts as fast — e.g. pages load in under 2 seconds at p95?"],
  ["learn better", "Which learning outcome should improve, and how will we measure it?"],
  ["look nice", "Which reference products or brand guidelines define the visual standard?"],
  ["all ages", "What age range exactly, and do children's privacy rules (parental consent) apply?"],
  ["AI-powered", "Which AI capabilities are needed specifically, and what should each do?"],
  ["user-friendly", "How will we measure usability — task time, error rate or satisfaction score?"],
  [
    "trustworthy",
    "What builds trust here — identity verification, reviews, guarantees or certifications?",
  ],
  ["personalised", "What should adapt to each user, and based on which data?"],
  ["affordable", "What price range or budget counts as affordable for this audience?"],
  ["accessible", "Which accessibility standard applies — e.g. WCAG 2.1 AA?"],
  ["engaging", "Which behaviour shows the product is engaging — e.g. weekly active use?"],
  ["gamified", "Which game mechanics are in scope (points, badges, streaks, leaderboards)?"],
  ["scalable", "What growth must it handle in the first year — users, data volume, peak load?"],
  [
    "intuitive",
    "How will we test that it is intuitive — e.g. usability sessions with 5 target users?",
  ],
  ["seamless", "Which hand-offs must be seamless, and what does failure look like today?"],
  ["premium", "Which qualities make it feel premium — design, service level, features?"],
  ["simpler", "Simpler than what, exactly — which steps or features should disappear?"],
  ["modern", "What does modern mean here — which reference products or design qualities?"],
  ["secure", "Which security requirements apply — e.g. SSO, encryption at rest, audit logs?"],
  ["better", "Better on which measure — speed, cost, accuracy or satisfaction?"],
  ["robust", "Which failures must it survive, and what recovery time is acceptable?"],
  ["safe", "Which risks must be prevented, and how will safety be verified?"],
  ["ASAP", "What is the actual target date, and what is the minimum scope for it?"],
  ["local", "What geographic area counts as local?"],
  ["fast", "What response time counts as fast — e.g. under 2 seconds at p95?"],
];

/** Role nouns recognised as actors (plural or singular as written). */
export const ACTOR_PATTERNS: RegExp[] = [
  /\b(customers?|users?|patients?|doctors?|front-desk staff|staff|managers?|employees?|admins?|administrators?)\b/gi,
  /\b(drivers?|inspectors?|supervisors?|teachers?|students?|parents?|suppliers?|vendors?|freelancers?)\b/gi,
  /\b(small businesses|policyholders?|claims handlers?|assessors?|garage partners?|fraud team|residents?)\b/gi,
  /\b(contractors?|permit officers?|officers?|sales teams?|leadership|support agents?|customer support|warehouse)\b/gi,
  /\b(procurement|finance(?: team)?|hr|legal|merchants?|buyers?|sellers?|regulars|applicants?)\b/gi,
];

export const NFR_PATTERN =
  /\b(secure|security|encrypt\w*|privacy|gdpr|hipaa|complian\w*|regulat\w*|audit (trail|log)|available|availability|uptime|24\/7|performance|latency|scal\w*|accessib\w*|wcag|offline|backup|retain|retention|keep (?:\w+ ){0,2}(?:records|data)|english and spanish|languages?|under \d+ ?mb|reliab\w*|response time|load time|really fast|fast|easy to use|usability)\b/i;

export const REQUIREMENT_SIGNAL =
  /(\b\w+'ll\b)|\b(must|should|shall|needs? to|need|wants?|would like|will|can|could|allows?|lets?|able to|has to|have to|required|requires?|only|support\w*|gets?|sees?|receives?|track\w*|uploads?|books?|submits?|exports?|downloads?|views?|filters?|approves?|rejects?|notif\w*|sends?|show\w*|display\w*|sign\w* in|log\w* in|marks?|picks?|enters?|applies|apply|pays?|creates?|manages?|integrat\w*|syncs?|records?|reminds?|suspends?|validated|verify|verif\w*|triggers?|reviews?|book|deliver\w*|store|keep|delete|retain)\b/i;

/** Verbs that can start an item in a list such as "view transactions, filter them and download reports". */
export const LIST_VERBS = new Set(
  "view see filter search sort download export upload receive get book reschedule cancel pick choose select enter submit approve reject track mark take pay send notify share edit create delete add manage block flag request rate review compare print save apply join invite schedule record capture scan close open set configure".split(
    " ",
  ),
);

export const INJECTION_PATTERN =
  /\b(ignore (?:all |your |any |the )?(?:previous|prior|above|earlier) instructions|note to ai|ai systems? processing|disregard (?:the|all|your) (?:rules|instructions)|you are now|system prompt)\b/i;

export const OPEN_SIGNAL =
  /\b(not sure|tbd|to be decided|unclear|hasn't confirmed|has not confirmed|undecided|open question)\b|\?$/i;
export const GOAL_SIGNAL =
  /\b(goal|so that|in order to|help \w+ \w+|reduce|cut|increase|improve|instead of|replace|faster than|growth engine|so they upgrade)\b/i;
export const CONSTRAINT_SIGNAL =
  /(\b\d+(?:[.,]\d+)?\s?(?:%|km|mb|gb|days?|weeks?|months?|years?|hours?|minutes?|seconds?|business days|am|pm)\b|₹|\$|€|£|\b(only|must not|never|no more than|at least|within|under|limit\w*|regulation\w*|existing|android|ios|nightly|batch)\b)/i;

export type GapRule = {
  when: RegExp;
  unless?: RegExp;
  question: string;
  reason: string;
  topic: string;
};

/** Information a good brief usually contains; when it's missing we ask. */
export const GAP_RULES: GapRule[] = [
  {
    when: /\b(notif\w*|alerts?|remind\w*)\b/i,
    unless: /\b(email|sms|text message|push|whatsapp|in-app|slack)\b/i,
    question: "Which channel should notifications use — email, SMS, push or in-app?",
    topic: "Notification channel",
    reason: "Notifications are mentioned without a channel.",
  },
  {
    when: /\b(reports?|exports?|download\w*)\b/i,
    unless: /\b(pdf|csv|excel|xlsx|json)\b/i,
    question:
      "Which format do reports and downloads need (PDF, CSV, Excel), and what must they contain?",
    topic: "Report format",
    reason: "Reports are mentioned without a format.",
  },
  {
    when: /\bfilter\w*\b/i,
    unless: /\bfilter\w* by\b/i,
    question: "Which fields should users be able to filter by?",
    topic: "Filter fields",
    reason: "Filtering is mentioned without fields.",
  },
  {
    when: /\b(failed|status\w*|states?)\b/i,
    question: "Which statuses exist, and what triggers each change of status?",
    topic: "Statuses",
    reason: "Statuses are referenced but not defined.",
  },
  {
    when: /\b(dashboard|portal|app|system|platform|customers?|patients?|employees?|students?|users?)\b/i,
    unless: /\b(log ?in|sign\w* in|sign-on|account|roles?|permission\w*|access|sso)\b/i,
    question:
      "Who can access it, how do they sign in, and do different roles see different things?",
    topic: "Access and sign-in",
    reason: "Users are described but access and roles are not.",
  },
  {
    when: /\b(pay\w*|refund\w*|price\w*|fees?|subscription|billing)\b/i,
    unless: /\b(card|bank transfer|upi|paypal|stripe|cash)\b/i,
    question: "Which payment methods and providers must be supported?",
    topic: "Payment methods",
    reason: "Payments are mentioned without methods.",
  },
  {
    when: /\b(patients?|health|medical|bank\w*|kyc|id document|personal data|children|students|all ages|insurance)\b/i,
    question: "Which privacy and compliance rules apply (consent, data retention, regulator)?",
    topic: "Privacy and compliance",
    reason: "The product handles sensitive personal data.",
  },
  {
    when: /\b(app|mobile)\b/i,
    unless: /\b(ios|android|web app|browser|desktop)\b/i,
    question: "Which platforms are in scope — iOS, Android, web?",
    topic: "Platforms",
    reason: "An app is mentioned without platforms.",
  },
  {
    when: /\b(api|integrat\w*|sync\w*|existing system|the system)\b/i,
    unless: /\b(sap|salesforce|stripe|jira|slack|soap|rest api|graphql)\b/i,
    question: "Which system or API do we integrate with, who owns it, and is there documentation?",
    topic: "Integration",
    reason: "An integration is mentioned without naming the system.",
  },
  {
    when: /\b(dashboard|kpis?|metrics?|reporting)\b/i,
    unless: /\b(revenue|churn|count of|average|conversion|number of)\b/i,
    question: "Which metrics must it show, and where does each number come from?",
    topic: "Metrics",
    reason: "A dashboard or report is mentioned without metrics.",
  },
  {
    when: /\b(book\w*|appointments?|slots?|reservations?)\b/i,
    question: "What is the appointment or slot length, and how far ahead can people book?",
    topic: "Booking rules",
    reason: "Booking is mentioned without slot rules.",
  },
  {
    when: /\bcancel\w*\b/i,
    question: "What happens after a cancellation or no-show — fees, limits, notifications?",
    topic: "Cancellation policy",
    reason: "Cancellations are mentioned without consequences.",
  },
  {
    when: /\b(returns?|refunds?)\b/i,
    question:
      "Which items or cases are excluded from returns, and are there fees or partial refunds?",
    topic: "Return exceptions",
    reason: "Returns or refunds are mentioned without exceptions.",
  },
  {
    when: /\b(approv\w*|reject\w*)\b/i,
    question:
      "Who approves when the usual approver is away, and is there an escalation or delegation path?",
    topic: "Approval cover",
    reason: "Approvals are mentioned without cover.",
  },
  {
    when: /\b(track\w*|location|map|gps)\b/i,
    question: "What location data is collected, who can see it, and when does tracking stop?",
    topic: "Location privacy",
    reason: "Location tracking raises privacy questions.",
  },
  {
    when: /\b(field|drivers?|inspectors?|tablets?|basements?|on site)\b/i,
    unless: /\boffline\b/i,
    question: "Must the app work without a network connection in the field?",
    topic: "Offline use",
    reason: "Field use often means poor connectivity.",
  },
  {
    when: /\b(country|countries|international|eu|uk|india|regions?)\b/i,
    question: "Which countries, currencies and languages are in scope at launch?",
    topic: "Countries and languages",
    reason: "Several regions are mentioned.",
  },
  {
    when: /\b(asap|launch|deadline|go live)\b/i,
    question: "What is the target launch date, and what is the must-have scope for it?",
    topic: "Launch date and scope",
    reason: "Timing is mentioned without a date.",
  },
];

/** Asked when the brief is very short: the basics of any discovery. */
export const BASELINE_QUESTIONS: [question: string, reason: string, topic: string][] = [
  [
    "Who are the primary users, and what problem does this solve for them?",
    "The brief doesn't describe users or their problem.",
    "Users and problem",
  ],
  [
    "What must the first release include, and what can wait?",
    "Scope isn't defined.",
    "First-release scope",
  ],
  ["How will we measure success after launch?", "No success metric is given.", "Success metric"],
  [
    "Are there existing tools, systems or data this must work with?",
    "Integrations and constraints aren't mentioned.",
    "Existing systems",
  ],
  [
    "Is there a deadline, budget or compliance requirement we must meet?",
    "Constraints aren't mentioned.",
    "Constraints",
  ],
];
