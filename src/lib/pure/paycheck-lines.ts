/**
 * Stored paycheck rows → the lines the paycheck calculator reads. The one
 * mapping both the Paycheck summary and the extra-paycheck routing use, so
 * a deduction's or earning's tax treatment can't differ between them.
 */
import type { DeductionLine, EarningLine } from "@/lib/calculators/types";

/** A deduction row (flags) with its resolved per-check amount. */
export function deductionLine(
  row: { deductionName: string; isPretax: boolean; ficaExempt: boolean },
  amount: number,
): DeductionLine {
  return {
    name: row.deductionName,
    amount,
    taxTreatment: row.isPretax ? "pre_tax" : "after_tax",
    ficaExempt: row.ficaExempt,
  };
}

/**
 * A job's other-pay rows with their per-check amounts from the Salary
 * Profile entry (`otherEarnings`, by row id). A row the profile gives no
 * amount (or $0) adds nothing and is left out.
 */
export function earningLines(
  rows: readonly {
    id: number;
    earningName: string;
    isCash: boolean;
    federalTaxable: boolean;
    ficaTaxable: boolean;
  }[],
  amounts: Readonly<Record<string, number>> | undefined,
): EarningLine[] {
  return rows.flatMap((r) => {
    const amount = amounts?.[String(r.id)] ?? 0;
    return amount > 0
      ? [
          {
            name: r.earningName,
            amount,
            isCash: r.isCash,
            federalTaxable: r.federalTaxable,
            ficaTaxable: r.ficaTaxable,
          },
        ]
      : [];
  });
}
