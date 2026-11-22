export type DiffPart = { kind: "same" | "removed" | "added"; text: string };

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Word-level diff of two wordings (PF-056). Returns parts in reading order: "same" words appear on both
 * sides, "removed" only on the left, "added" only on the right. Adjacent words of one kind are merged.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = words(before);
  const b = words(after);
  // Longest common subsequence table, built from the end so the walk below runs forwards.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], word: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += ` ${word}`;
    else parts.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      push("added", b[j]!);
      j++;
    } else {
      push("removed", a[i]!);
      i++;
    }
  }
  return parts;
}
