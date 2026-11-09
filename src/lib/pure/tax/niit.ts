/** Net Investment Income Tax for a year: the rate and threshold tables live in lib/config/niit.ts. */
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { NIIT_RATE, niitThresholdFor } from "@/lib/config/niit";

/** NIIT = 3.8% × min(netInvestmentIncome, max(0, magi - threshold)), rounded to cents.
 *  `magi` includes Roth conversions and gains; `netInvestmentIncome` is mostly brokerage
 *  gains in projections. */
export function computeNiit(
  magi: number,
  netInvestmentIncome: number,
  filingStatus: ReturnFilingStatus,
): number {
  if (netInvestmentIncome <= 0) return 0;

  const threshold = niitThresholdFor(filingStatus);
  const magiExcess = Math.max(0, magi - threshold);
  if (magiExcess <= 0) return 0;

  const taxableAmount = Math.min(netInvestmentIncome, magiExcess);
  return Math.round(taxableAmount * NIIT_RATE * 100) / 100;
}
