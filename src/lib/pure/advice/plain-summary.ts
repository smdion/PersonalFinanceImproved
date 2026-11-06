/**
 * "In plain words" — one sentence summing up a page, built only from
 * figures the page already shows (no new math here: every number is passed
 * in as-is).
 */
import { formatCurrency, formatSavingsRate } from "@/lib/utils/format";

export function contributionsSummaryLine({
  rate,
  annualAmount,
  matchIncluded,
  includePortfolio,
  nextAction,
}: {
  /** The household savings rate the page's Total card shows. */
  rate: number;
  /** The yearly dollars behind it. */
  annualAmount: number;
  matchIncluded: boolean;
  includePortfolio: boolean;
  /** The top paycheck recommendation's action, if any. */
  nextAction: string | null;
}): string {
  const what = [
    includePortfolio ? null : "retirement accounts only",
    matchIncluded ? "employer match included" : "before employer match",
  ]
    .filter(Boolean)
    .join(", ");
  const saving = `You're saving ${formatSavingsRate(rate)} of your pay — ${formatCurrency(annualAmount)} a year (${what}).`;
  return nextAction ? `${saving} Next: ${nextAction}.` : saving;
}
