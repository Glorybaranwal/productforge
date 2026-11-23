import type { Bucket } from "./rate-limit";

/**
 * Who may open which path (PF-013, ADR-021). Pure, so the rules are unit-tested. `proxy.ts` applies
 * them on every request; `getSession()` verifies the user again wherever data is read.
 */
export const HOME_PATH = "/dashboard";
export const LOGIN_PATH = "/login";

export type GateDecision =
  { kind: "next" } | { kind: "redirect"; to: string } | { kind: "unauthorized" };

const NEXT: GateDecision = { kind: "next" };
const INTERNAL_ORIGIN = "http://internal.invalid";

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Signed-out: the API answers 401 and dashboard pages go to sign-in (then back). Signed-in: the
 * sign-in page forwards to where the user was going. Everything else is public.
 */
export function gate(url: { pathname: string; search: string }, signedIn: boolean): GateDecision {
  const { pathname, search } = url;
  if (under(pathname, "/api")) return signedIn ? NEXT : { kind: "unauthorized" };
  if (under(pathname, HOME_PATH)) {
    if (signedIn) return NEXT;
    return { kind: "redirect", to: `${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}` };
  }
  if (under(pathname, LOGIN_PATH) && signedIn) {
    return { kind: "redirect", to: safeNext(new URLSearchParams(search).get("next")) };
  }
  return NEXT;
}

/**
 * A path on this site to land on after signing in. Anything else — another site, a protocol-relative
 * or backslash trick, the sign-in pages themselves — falls back to the dashboard (no open redirect).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(raw, INTERNAL_ORIGIN);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== INTERNAL_ORIGIN) return HOME_PATH;
  if (under(url.pathname, LOGIN_PATH) || under(url.pathname, "/auth")) return HOME_PATH;
  return url.pathname + url.search + url.hash;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * A state-changing request to the API or auth routes sent from another site (CSRF). Browsers send
 * `Origin` on such requests; without it, `Sec-Fetch-Site` tells. Requests from tools without either
 * carry no browser cookies, so they're let through to the normal sign-in check.
 */
export function isCrossSiteWrite(request: {
  method: string;
  pathname: string;
  selfOrigin: string;
  origin: string | null;
  secFetchSite: string | null;
}): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return false;
  if (!under(request.pathname, "/api") && !under(request.pathname, "/auth")) return false;
  if (request.origin) return request.origin !== request.selfOrigin;
  return request.secFetchSite === "cross-site";
}

/**
 * Which kind of request this is, decided once in `proxy.ts` and passed to the app in a header
 * (PF-083, ADR-036). `currentContext` honours an API key only on an `api-*` surface, so a key can
 * never open a `/dashboard` page. `api-write` is any method that can change state, which is how a
 * `read` key is held to reads even on routes with no role check (members may add sources, edit
 * drafts and so on). Anything that isn't `/api` is a `page`.
 *
 * Deliberate exception: a safe method may append an audit row. Three GET routes (the PRD and backlog
 * Markdown and the traceability CSV) call `recordExport`, which only calls `recordAudit`, and a `read`
 * key must still be able to export: CI pulling data and the Jira sync are what ADR-036 is for. An
 * audit row records that a read happened; it is not domain state. Suppressing it would lose the event
 * you most want traced. Anything beyond audit on a safe method is a defect: make the route a POST.
 */
export type Surface = "page" | "api-read" | "api-write";
export const SURFACE_HEADER = "x-pf-surface";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requestSurface(pathname: string, method: string): Surface {
  if (!under(pathname, "/api")) return "page";
  return SAFE_METHODS.has(method.toUpperCase()) ? "api-read" : "api-write";
}

/** Set by `proxy.ts` on every request, overwritten or removed so a client-sent value never survives. */
export const BUCKET_HEADER = "x-pf-bucket";

const SEG = "[^/]+";
const route = (pattern: string) => new RegExp(`^/api/${pattern}$`);
const UPLOAD = route(`projects/${SEG}/sources`);
const EXPORTS = [
  route(`prds/${SEG}/markdown`),
  route(`projects/${SEG}/backlog/markdown`),
  route(`projects/${SEG}/traceability/csv`),
  route(`projects/${SEG}/exports/jira`),
];
const GENERATE = [
  route(`projects/${SEG}/discovery`),
  route(`projects/${SEG}/prd/generate`),
  route(`projects/${SEG}/backlog/generate`),
  route(`changes/${SEG}/analyze`),
  route(`projects/${SEG}/changes`),
  route(`stories/${SEG}/regenerate`),
];

/**
 * Which rate limit a request counts against (PF-084, ADR-037), or null when it is not metered. Lives
 * beside `requestSurface` so the two rules stay together; `proxy.ts` stamps it in a header, and
 * `currentContext` reads it. Only `/api` is ever metered: a page render is a cookie-authenticated
 * human in a browser, and ADR-023 fought for its 86-226 ms (Global Constraint 2).
 *
 * `generate` is every route that reaches the stage runner (and so `checkRunBudget`): found by tracing
 * callers of `runStage`, not from memory. That includes `POST /projects/:id/changes`, which analyses
 * the change it creates. `sprints/plan` is NOT one: the planner is deterministic and calls no model.
 * A new generating route must be added here, or it silently gets `write`'s 60/min instead of 12.
 */
export function rateBucket(pathname: string, method: string): Bucket | null {
  if (!under(pathname, "/api")) return null;
  // `//` and a trailing slash must not slip a route out of its class.
  const path = pathname.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  const verb = method.toUpperCase();
  if (EXPORTS.some((r) => r.test(path))) return "export";
  if (verb === "POST" && UPLOAD.test(path)) return "upload";
  if (verb === "POST" && GENERATE.some((r) => r.test(path))) return "generate";
  return SAFE_METHODS.has(verb) ? "read" : "write";
}
