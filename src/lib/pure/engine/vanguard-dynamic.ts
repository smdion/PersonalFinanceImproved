/**
 * Vanguard Dynamic (Floor & Ceiling), Morningstar Method 8: a base percentage of
 * balance, with a ceiling and floor on year-over-year spending changes.
 * SWR: 4.7% (40/60 portfolio, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  VanguardDynamicParams,
} from "./spending-strategy";

export function applyVanguardDynamic(
  params: VanguardDynamicParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const { portfolioBalance, crossYearState } = input;
  const { basePercent, ceilingPercent, floorPercent } =
    params as VanguardDynamicParams;

  const raw = portfolioBalance * basePercent;

  // First decumulation year: no prior spending to clamp against
  if (crossYearState.priorYearSpending === null) {
    const spending = roundToCents(raw);
    return {
      projectedExpenses: spending,
      amountKind: "portfolio_withdrawal",
      action: null,
      updatedState: { priorYearSpending: spending },
    };
  }

  // Nominal limits, like every rate-based strategy's floor: an inflation-adjusted
  // floor would push withdrawals past what the portfolio sustains in bad years.
  // The published method applies them to real spending; the guide says so.
  const prior = crossYearState.priorYearSpending;
  const ceiling = prior * (1 + ceilingPercent);
  const yoyFloor = prior * (1 - floorPercent);

  let action: string | null = null;
  let spending = raw;

  if (raw > ceiling) {
    spending = ceiling;
    action = "ceiling_applied";
  } else if (raw < yoyFloor) {
    spending = yoyFloor;
    action = "floor_applied";
  }

  spending = roundToCents(spending);

  return {
    projectedExpenses: spending,
    amountKind: "portfolio_withdrawal",
    action,
    updatedState: { priorYearSpending: spending },
  };
}
