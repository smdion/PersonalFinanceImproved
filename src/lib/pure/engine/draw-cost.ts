/** What a year's draw costs: one rule for the solver's sizing and the year's settlement. */
import { roundToCents } from "../../utils/math";
import { drawNiit } from "../tax/niit";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

/** Social Security's surplus credited against a tax: never more than the tax
 *  (the surplus isn't banked). */
export function surplusCreditFor(ssSurplus: number, tax: number): number {
  return roundToCents(Math.min(ssSurplus, Math.max(0, tax)));
}

/**
 * The draw's tax with the NIIT it adds (conversions left out of MAGI), its
 * early-withdrawal penalty, and `netCost`: what the withdrawal itself must
 * pay, Social Security's surplus credited against the tax.
 */
export function drawCost(
  priced: {
    taxCost: number;
    penaltyCost: number;
    totalTraditionalWithdrawal: number;
    rothTaxableGrowth: number;
    brokerageGainsPortion: number;
  },
  taxableSS: number,
  filingStatus: ReturnFilingStatus | null | undefined,
  ssSurplus: number,
) {
  const niit = drawNiit(priced, taxableSS, filingStatus);
  const taxCost = roundToCents(priced.taxCost + niit);
  const totalCost = roundToCents(taxCost + priced.penaltyCost);
  return {
    taxCost,
    penaltyCost: priced.penaltyCost,
    totalCost,
    netCost: roundToCents(totalCost - surplusCreditFor(ssSurplus, taxCost)),
  };
}
