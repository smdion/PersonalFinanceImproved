/** The Form 1040 liability's tax brackets, from a withholding table. */
import type { TaxBracketInput } from "@/lib/pure/paycheck/paycheck.types";
import {
  buildBracketInput,
  type WithholdingTableRow,
} from "@/lib/pure/paycheck/withholding";
import { toTaxableIncomeBrackets } from "@/lib/pure/tax/tax-brackets";

/** A Step 2(c) checkbox table was handed to buildLiabilityBracketInput: its
 *  half-tables have no Form 1040 analogue. A service answers it as the
 *  client's BAD_REQUEST, with this message. */
export class StandardW4BracketsRequiredError extends Error {
  constructor() {
    super(
      "This calculation needs standard W-4 tax brackets (not the multiple-jobs checkbox).",
    );
    this.name = "StandardW4BracketsRequiredError";
  }
}

/** Annual-liability brackets: buildBracketInput's, reshaped into Form 1040
 *  taxable-income space (toTaxableIncomeBrackets), which calculateHouseholdTax
 *  reads. Needs the standard (non-2c) table. */
export function buildLiabilityBracketInput(
  bracketRow: WithholdingTableRow,
  limits: Map<string, number>,
): TaxBracketInput {
  if (bracketRow.w4Checkbox) throw new StandardW4BracketsRequiredError();
  // No yearBrackets: the liability path never reads w4Adjustment.
  const base = buildBracketInput(bracketRow, limits, []);
  return { ...base, brackets: toTaxableIncomeBrackets(base.brackets) };
}
