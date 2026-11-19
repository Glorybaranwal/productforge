/** Lower-case, punctuation-free form used to compare texts ("Filter, by date!" → "filter by date"). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%₹$€£+]+/gu, " ")
    .trim();
}

/** True when `needle` occurs in `haystack`, ignoring case and runs of whitespace. */
export function containsQuote(haystack: string, needle: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const n = squash(needle);
  return n.length > 0 && squash(haystack).includes(n);
}

/** SHA-256 hex digest (Web Crypto: Node 20+ and secure browser contexts), with a non-crypto fallback. */
export async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5; // FNV-1a, only where Web Crypto is unavailable
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

const STOPWORDS = new Set(
  "a an the and or of to for in on at by with from as is are be been it its this that these those we our you your they their them i me my can could should would will shall must may might do does did has have had so if then than into onto per via about over under up out not no".split(
    " ",
  ),
);

/** Lower-cased content words with simple plural folding (ADR-010 Tier 1). */
export function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}
