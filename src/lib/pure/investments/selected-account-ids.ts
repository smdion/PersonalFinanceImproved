/** Performance's custom filter: the accounts a stored selection names. */

/** The stored selection as ids: "" = never chosen (default to all);
 *  "none" = explicitly empty selection; else ids joined by commas. */
export function selectedAccountIdsFrom(
  stored: unknown,
  all: Set<number>,
): Set<number> {
  return stored === "none"
    ? new Set<number>()
    : typeof stored === "string" && stored
      ? new Set(
          stored
            .split(",")
            .map(Number)
            .filter((n) => !Number.isNaN(n)),
        )
      : all;
}
