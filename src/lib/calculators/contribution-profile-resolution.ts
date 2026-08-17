/**
 * Resolve which Contribution / Salary Profile applies to a given budget
 * column — the only place that decision is ever made.
 *
 * The precedence is the one documented in docs/RULES.md ("Profile Pins"):
 *
 *   Plan pin → per-budget-column pin → local page selection → globally-active
 *
 * and it is expressed here as a required options object rather than
 * positional arguments **on purpose**. Every tier is a named field a caller
 * must supply explicitly: a forgotten positional argument used to fall back
 * silently to the wrong tier (which is exactly how the Plan pin ended up
 * being fed into the lowest tier and losing to a column pin — the bug this
 * shape prevents from recurring), whereas a missing required field simply
 * doesn't compile.
 *
 * `null` at the pin tiers (`planPinId`, any element of `columnPinIds`) means
 * "this Plan/column pins nothing — fall through to the next tier". It is NOT
 * a profile id and must never be rewritten to one, or every unpinned column
 * silently becomes pinned. `null` out of these functions therefore only
 * happens when no tier resolves (e.g. the globally-active id hasn't loaded
 * yet); post-migration the setting always names a real row.
 *
 * A `columnPinIds` array whose length doesn't match `numColumns`
 * (stale/mismatched shape) is treated as "no per-column overrides at all" —
 * every column falls through to the next tier — rather than silently
 * indexing into a mismatched array.
 *
 * Both server-side budget item $ computation (routers/budget.ts) and
 * client-side payroll breakdown display (use-budget-derived-data.ts) must
 * resolve this identically for the same column, or the two numbers on screen
 * silently disagree about which contribution/salary reality is in effect.
 * Isomorphic (no I/O) so both sides can import it directly instead of
 * re-deriving the chain inline.
 *
 * This is a pure calculator (docs/RULES.md's pure-calculator boundary): it
 * knows nothing about which UI surface is asking. A page-level preview (the
 * Budget page's What-If tab, a viewing dropdown, …) is simply a caller that
 * fills the `localSelectionId` tier — there is no UI-specific mode in here.
 */

/** One column's worth of tiers, for a single profile axis. */
export type ColumnProfileResolutionInput = {
  /** The active Plan's pin for this axis, or null when it pins nothing. */
  planPinId: number | null;
  /**
   * `budget_profiles.column_contribution_profile_ids` /
   * `.column_salary_profile_ids` — same length as the profile's columns.
   */
  columnPinIds: (number | null)[] | null | undefined;
  numColumns: number;
  /** Which column is being resolved. */
  column: number;
  /** The page's own local selection tier (a viewing dropdown / preview pick). */
  localSelectionId: number | null;
  /** The globally-active profile id for this axis. */
  globalDefaultId: number | null;
};

/** Same tiers, resolving every column at once. */
export type AllColumnsProfileResolutionInput = Omit<
  ColumnProfileResolutionInput,
  "column"
>;

/**
 * The single implementation of the documented precedence. Both axes call
 * this; they stay separate exported functions (rather than one function with
 * a "profile kind" parameter) so a column can pin a Contribution Profile
 * without implicitly pinning a Salary Profile, and vice versa.
 */
function resolveProfileIdForColumn(
  input: ColumnProfileResolutionInput,
): number | null {
  if (input.planPinId != null) return input.planPinId;

  const { columnPinIds, numColumns, column } = input;
  const columnPin =
    columnPinIds && columnPinIds.length === numColumns
      ? (columnPinIds[column] ?? null)
      : null;
  if (columnPin != null) return columnPin;

  if (input.localSelectionId != null) return input.localSelectionId;

  return input.globalDefaultId ?? null;
}

function resolveForAllColumns(
  input: AllColumnsProfileResolutionInput,
): (number | null)[] {
  return Array.from({ length: input.numColumns }, (_, column) =>
    resolveProfileIdForColumn({ ...input, column }),
  );
}

/** Contribution Profile axis, one column. */
export function resolveContributionProfileId(
  input: ColumnProfileResolutionInput,
): number | null {
  return resolveProfileIdForColumn(input);
}

/** Contribution Profile axis, every column at once. */
export function resolveContributionProfileIdsForAllColumns(
  input: AllColumnsProfileResolutionInput,
): (number | null)[] {
  return resolveForAllColumns(input);
}

/** Salary Profile axis (independent second axis), one column. */
export function resolveSalaryProfileId(
  input: ColumnProfileResolutionInput,
): number | null {
  return resolveProfileIdForColumn(input);
}

/** Salary Profile axis, every column at once. */
export function resolveSalaryProfileIdsForAllColumns(
  input: AllColumnsProfileResolutionInput,
): (number | null)[] {
  return resolveForAllColumns(input);
}
