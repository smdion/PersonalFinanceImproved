/** The Pub 15-T withholding input for one stored withholding table. */

import type { W4FilingStatus } from "@/lib/config/filing-status";
import { requireLimit } from "@/lib/pure/tax/tax-limits";
import type { TaxBracketInput } from "./paycheck.types";

/** One stored withholding table (a `tax_brackets` row): its year, W-4
 *  status, Step 2(c) box, and thresholds with their rates. */
export type WithholdingTableRow = {
  taxYear: number;
  filingStatus: W4FilingStatus;
  w4Checkbox: boolean;
  brackets: readonly { threshold: number; rate: number }[];
};

/**
 * The standard deduction Pub 15-T's withholding tables were built on, read
 * off the tables themselves: the Step 2(c) checkbox table's first taxed
 * threshold is half of it. Usually the same as the tax-return figure in
 * contribution_limits, but not always — OBBBA raised the 2025 return
 * deduction to $31,500 MFJ after the 2025 withholding tables (built on
 * $30,000) were published, and payroll kept withholding on those tables.
 * Null when the year has no checkbox table for this filing status.
 */
function withholdingStandardDeduction(
  bracketRow: WithholdingTableRow,
  yearBrackets: readonly WithholdingTableRow[],
): number | null {
  const checkbox = yearBrackets.find(
    (b) =>
      b.taxYear === bracketRow.taxYear &&
      b.filingStatus === bracketRow.filingStatus &&
      b.w4Checkbox,
  );
  const threshold = checkbox?.brackets[1]?.threshold;
  return threshold === undefined ? null : threshold * 2;
}

/** Build TaxBracketInput from DB bracket row + limits. `yearBrackets`
 *  (the same year's rows) lets the W-4 adjustment follow the withholding
 *  tables' own standard deduction — see withholdingStandardDeduction.
 *  Required on purpose: without it the adjustment falls back to the
 *  tax-return deduction, which is wrong for 2025 withholding. */
export function buildBracketInput(
  bracketRow: WithholdingTableRow,
  limits: Map<string, number>,
  yearBrackets: readonly WithholdingTableRow[],
): TaxBracketInput {
  const brackets = bracketRow.brackets.map((b, i, arr) => ({
    min: b.threshold,
    max: i < arr.length - 1 ? arr[i + 1]!.threshold : null,
    rate: b.rate,
  }));

  const standardDeduction = requireLimit(
    limits,
    `standard_deduction_${bracketRow.filingStatus.toLowerCase()}`,
  );
  // Pub 15-T Worksheet 1A line 1g: the tables' standard deduction minus
  // the standard table's own first non-zero threshold — the threshold alone is only
  // ONE term of the real offset, not the whole thing. This previously
  // used `brackets[1].threshold`
  // alone as the full adjustment, e.g. $19,300 MFJ for 2026 instead of the
  // real $32,200 - $19,300 = $12,900, under-withholding a $120k MFJ
  // household by ~$768/yr at the 12% bracket, more at higher brackets.
  // Mirrors tax-estimation.ts's toOrdinaryBracketIncome, which computes
  // this same residual correctly — see that function's docblock. 0 for
  // w4Checkbox=true rows (2(c) tables assume no worksheet adjustment).
  const tableDeduction =
    withholdingStandardDeduction(bracketRow, yearBrackets) ?? standardDeduction;
  const w4Adjustment = bracketRow.w4Checkbox
    ? 0
    : Math.max(0, tableDeduction - (bracketRow.brackets[1]?.threshold ?? 0));

  return {
    filingStatus: bracketRow.filingStatus,
    w4Checkbox: bracketRow.w4Checkbox,
    brackets,
    w4Adjustment,
    standardDeduction,
    socialSecurityWageBase: requireLimit(limits, "ss_wage_base"),
    socialSecurityRate: requireLimit(limits, "fica_ss_rate"),
    medicareRate: requireLimit(limits, "fica_medicare_rate"),
    medicareAdditionalRate: requireLimit(limits, "fica_medicare_surtax_rate"),
    medicareAdditionalThreshold: requireLimit(
      limits,
      "fica_medicare_surtax_threshold",
    ),
  };
}
