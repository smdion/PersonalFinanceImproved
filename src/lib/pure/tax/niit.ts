/** Net Investment Income Tax for a year: the rate and threshold tables live in lib/config/niit.ts. */
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { NIIT_RATE, niitThresholdFor } from "@/lib/config/niit";
import { yearMagi } from "./year-income";

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

/** A decumulation draw's NIIT, as the withdrawal is sized for it: MAGI from
 *  the draw's own income, the year's conversions (priced later) left out.
 *  No filing status ⇒ none. */
export function drawNiit(
  draw: {
    totalTraditionalWithdrawal: number;
    rothTaxableGrowth: number;
    brokerageGainsPortion: number;
  },
  taxableSS: number,
  filingStatus: ReturnFilingStatus | null | undefined,
): number {
  const magi = yearMagi(
    {
      wages: 0,
      traditionalDraws: draw.totalTraditionalWithdrawal,
      rothTaxableGrowth: draw.rothTaxableGrowth,
      rothConversions: 0,
      realizedGains: draw.brokerageGainsPortion,
      socialSecurity: { taxable: taxableSS },
    },
    "niit",
  );
  return filingStatus
    ? computeNiit(magi, draw.brokerageGainsPortion, filingStatus)
    : 0;
}
