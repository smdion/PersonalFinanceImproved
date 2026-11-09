/**
 * Pure merge logic for Actual category goals, which the API can only set via
 * note templates (`#template <amount>` / `#template up to <amount>`) in the
 * same note as the household's free text, so other note content is kept.
 */

/** The two goal shapes Ledgr's `BudgetAPIClient.prepareGoalWrite` writes —
 * its `"monthly"` (recurring monthly assignment) and `"target-balance"`
 * (refill-to-a-balance-cap) respectively. */
export type ActualTemplateShape = "fixed" | "target-balance";

type MergeGoalResult =
  { ok: true; note: string } | { ok: false; reason: string };

// Matches ONLY the bare shapes Ledgr writes. Any other template (priority
// suffix, combined form, `by <date>`, `% of`, …) counts as "a different shape
// exists" and is never reinterpreted or overwritten.
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

/** New note text for writing `amount` as a `shape` goal: replaces a
 *  same-shape template's amount in place, else appends a `#template` line;
 *  any other template present returns `ok: false` and is left alone. */
export function mergeGoalIntoNote(
  existingNote: string | null | undefined,
  shape: ActualTemplateShape,
  amount: number,
): MergeGoalResult {
  // A negative amount would write `#template -50`, which the digits-only
  // regexes never match again, locking the goal out of later updates.
  if (!Number.isFinite(amount) || amount < 0) {
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

/** Read counterpart to `mergeGoalIntoNote`: the amount of the note's
 *  `shape` template, so a preview compares against what a push wrote.
 *  `undefined` when no template of that shape is present. */
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
