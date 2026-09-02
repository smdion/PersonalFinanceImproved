/**
 * Actual Budget has no structured API field for a category's goal amount
 * (verified against `@actual-app/api`'s docs: `updateCategory` only accepts
 * name/group_id/is_income, on any release channel — the newer Budget
 * Automations `goal_def` field was never exposed through the API). The
 * real, working mechanism is Actual's older note-based template syntax
 * (`#template <amount>` / `#template up to <amount>`), written via the
 * actual-http-api wrapper's `PUT /notes/category/:id` endpoint — the SAME
 * endpoint a household's plain free-text category notes live in.
 *
 * This module is the pure merge logic: given whatever a category's note
 * field already contains, decide what to write WITHOUT destroying anything
 * else the household put there. Kept separate from `actual-client.ts` (no
 * I/O here) so the merge behavior is unit-testable without mocking fetch.
 */

/** The two goal shapes Ledgr's `BudgetAPIClient` interface writes —
 * matches `updateCategoryGoalTarget` (recurring monthly assignment) and
 * `updateCategoryTargetBalance` (refill-to-a-balance-cap) respectively. */
export type ActualTemplateShape = "fixed" | "target-balance";

export type MergeGoalResult =
  { ok: true; note: string } | { ok: false; reason: string };

// Matches ONLY the exact bare shapes Ledgr writes — deliberately narrow.
// Priority suffixes (`#template-1`), combined forms (`50 up to 300`), and
// every other template type (`by <date>`, `repeat every...`, `% of`,
// `average`, `copy from`, `schedule`, `remainder`) are treated as "a
// different shape already exists" rather than silently reinterpreted or
// clobbered — the same "never touch an existing goal's shape, only its
// amount" contract `updateCategoryTargetBalance`'s YNAB implementation
// already keeps.
const FIXED_RE = /^#template[ \t]+([0-9]+(?:\.[0-9]+)?)[ \t]*$/im;
const TARGET_BALANCE_RE =
  /^#template[ \t]+up[ \t]+to[ \t]+([0-9]+(?:\.[0-9]+)?)[ \t]*$/im;
const ANY_TEMPLATE_RE = /^#template\b.*$/im;

function formatAmount(amount: number): string {
  // Actual's template syntax takes a plain decimal dollar amount (this
  // note-based mechanism is NOT cents-denominated, unlike Actual's other
  // budget/transaction endpoints) — bare integer when whole, else 2dp.
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * Compute the new note text for writing `amount` as a `shape` goal.
 *
 * - An existing template of the SAME shape: its amount is replaced in
 *   place, everything else in the note untouched.
 * - No template at all: a fresh `#template` line is appended, preserving
 *   any existing free-text note content.
 * - An existing template of a DIFFERENT shape (priority-tagged, combined,
 *   date-based, percentage, average, copy, schedule, remainder, or the
 *   other bare shape): left alone — `ok: false` with a reason, the same
 *   "don't touch what wasn't asked for" contract as the YNAB target-
 *   balance write.
 */
export function mergeGoalIntoNote(
  existingNote: string | null | undefined,
  shape: ActualTemplateShape,
  amount: number,
): MergeGoalResult {
  // A negative amount would write `#template -50` — FIXED_RE/
  // TARGET_BALANCE_RE are digits-only (no sign), so that line can never
  // be matched again on a later write, permanently falling into the
  // ANY_TEMPLATE_RE "different shape" branch and locking this category's
  // goal out of all future updates (advisor review, 2026-08-29). Reject
  // up front instead of writing malformed, self-poisoning syntax — a
  // negative goal amount isn't meaningful in Actual's template syntax
  // anyway.
  if (amount < 0) {
    return {
      ok: false,
      reason: `Goal amount must be zero or positive (got ${amount}).`,
    };
  }
  const note = existingNote ?? "";
  const targetLine =
    shape === "fixed"
      ? `#template ${formatAmount(amount)}`
      : `#template up to ${formatAmount(amount)}`;
  const shapeRe = shape === "fixed" ? FIXED_RE : TARGET_BALANCE_RE;

  if (shapeRe.test(note)) {
    return { ok: true, note: note.replace(shapeRe, targetLine) };
  }
  if (ANY_TEMPLATE_RE.test(note)) {
    return {
      ok: false,
      reason:
        "This category's note already has a #template that isn't a plain " +
        `${shape === "fixed" ? "fixed monthly amount" : '"up to" target balance'} ` +
        "— left untouched to avoid overwriting a goal shape configured " +
        "directly in Actual.",
    };
  }
  const trimmed = note.trim();
  return {
    ok: true,
    note: trimmed.length > 0 ? `${trimmed}\n${targetLine}` : targetLine,
  };
}

/**
 * Read counterpart to `mergeGoalIntoNote` — extracts the CURRENT amount
 * Ledgr itself last wrote to a category's note, for a given `shape`.
 *
 * Why this exists: `getCategories()`'s `cat.goal` (`actual-client.ts`)
 * reads Actual's newer `goal_def` field, which `writeGoalNote` never
 * writes to (there's no API to write it — see that function's own
 * docblock). Comparing a push/pull preview's "current" value against
 * `goal_def` would show every Ledgr-managed goal as permanently changed,
 * even immediately after a successful push, because the two never talk
 * to the same field. This function reads the note instead — the ONLY
 * field Ledgr's write path actually touches — so the diff is internally
 * consistent with what a push/pull will actually do.
 *
 * Returns `undefined` when no template of the requested `shape` is
 * present (no goal set via this mechanism yet, or a different shape is
 * there — same "don't guess" contract `mergeGoalIntoNote` uses for its
 * own "different shape" case).
 */
export function parseGoalFromNote(
  existingNote: string | null | undefined,
  shape: ActualTemplateShape,
): number | undefined {
  const note = existingNote ?? "";
  const shapeRe = shape === "fixed" ? FIXED_RE : TARGET_BALANCE_RE;
  const match = note.match(shapeRe);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : undefined;
}
