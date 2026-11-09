/** Performance's custom filter: the accounts a stored selection names. */

/** The stored selection as ids: "" = never chosen (default to all);
 *  "none" = explicitly empty selection; else ids joined by commas (one id
 *  may be stored as a number). */
export function selectedAccountIdsFrom(
  stored: unknown,
  all: Set<number>,
): Set<number> {
  const ids = typeof stored === "number" ? String(stored) : stored;
  return ids === "none"
    ? new Set<number>()
    : typeof ids === "string" && ids
      ? new Set(
          ids
            .split(",")
            .map(Number)
            .filter((n) => !Number.isNaN(n)),
        )
      : all;
}
