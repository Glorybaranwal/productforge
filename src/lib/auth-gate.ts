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
