/**
 * A procedure's numbers: its result with everything but numbers taken out.
 * Kept: every number, and every string that is only a number (a decimal
 * column comes back as "58000.00" on one database and 58000 on the
 * other). Text is never kept, so a wording or label change can't fail the
 * baseline. Left out: ids and keys ending in Id/Ids (row ids are the
 * seeder's insertion order, not a figure), timestamps (keys ending in At,
 * and Date values) and timings (keys ending in Ms, e.g. computeTimeMs).
 *
 * The file holds the result's shape with only its numbers (`numberTree`):
 * object keys sorted, a branch with no number dropped, an array element
 * with no number kept as null so indexes stay put. Comparison is on
 * `flatten`, path by path, so a failure names the figure that moved.
 */
const NOT_A_FIGURE = /^id$|Id$|Ids$|At$|Ms$/;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

export type NumberTree =
  number | string | null | NumberTree[] | { [key: string]: NumberTree };

/** Six decimals: below any displayed figure (cents, a rate's basis point),
 *  above floating-point noise. NaN and ±Infinity are kept, as text. */
function round(n: number): number | string {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/** The value's numbers in its own shape; `undefined` when it has none. */
export function numberTree(value: unknown): NumberTree | undefined {
  if (typeof value === "number") return round(value);
  if (typeof value === "string")
    return NUMBER_TEXT.test(value) ? round(Number(value)) : undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => numberTree(item) ?? null);
    return items.some((item) => item !== null) ? items : undefined;
  }
  const entries =
    value instanceof Map
      ? [...value.entries()].map(([k, v]) => [String(k), v] as const)
      : value && typeof value === "object" && !(value instanceof Date)
        ? Object.entries(value)
        : [];
  const kept = entries
    .filter(([key]) => !NOT_A_FIGURE.test(key))
    .map(([key, item]) => [key, numberTree(item)] as const)
    .filter((e): e is [string, NumberTree] => e[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** Every number in a tree, by path (`$.result.rows[3].tax`). */
export function flatten(
  tree: NumberTree | undefined,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const walk = (node: NumberTree | undefined, at: string) => {
    if (node === null || node === undefined) return;
    if (typeof node === "number" || typeof node === "string") out[at] = node;
    else if (Array.isArray(node))
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
    else
      for (const [key, item] of Object.entries(node))
        walk(item, `${at}.${key}`);
  };
  walk(tree, "$");
  return out;
}
