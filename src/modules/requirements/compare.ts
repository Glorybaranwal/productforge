/** Orders two versions of a requirement so a comparison always reads old to new (PF-056). */
export function orderPair<T extends { version: number }>(a: T, b: T): [older: T, newer: T] {
  return a.version <= b.version ? [a, b] : [b, a];
}
