/** The paycheck input's range warnings: data-entry errors flagged before any figure. */
import type { PaycheckInput } from "./paycheck.types";
import { formatPercent } from "../../utils/format";

/** Warnings for out-of-range salary, bonus terms and deductions. */
export function inputWarnings(input: PaycheckInput) {
  const warnings: string[] = [];

  // Range validation — catch data-entry errors before they propagate
  if (input.annualSalary < 0) {
    warnings.push("Annual salary is negative — results may be incorrect.");
  }
  if (input.annualSalary > 10_000_000) {
    warnings.push("Annual salary exceeds $10M — verify this is correct.");
  }
  if (input.bonusPercent < 0 || input.bonusPercent > 5) {
    warnings.push(
      `Bonus percent ${formatPercent(input.bonusPercent)} is outside expected range (0-500%).`,
    );
  }
  if (input.bonusMultiplier < 0 || input.bonusMultiplier > 10) {
    warnings.push(
      `Bonus multiplier ${input.bonusMultiplier}x is outside expected range (0-10x).`,
    );
  }
  for (const d of input.deductions) {
    if (d.amount < 0) {
      warnings.push(`Deduction "${d.name}" has a negative amount.`);
    }
  }
  return { warnings };
}
