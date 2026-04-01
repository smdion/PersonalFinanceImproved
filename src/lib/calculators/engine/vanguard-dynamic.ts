/**
 * Vanguard Dynamic (Floor & Ceiling) — Morningstar Method 8.
 *
 * Base percentage of current balance, with ceiling and floor on
 * year-over-year spending changes. Limits both upside and downside
 * volatility in cash flows.
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
  const p = params as VanguardDynamicParams;
  const basePercent = p.basePercent ?? 0.05;
  const ceilingPercent = p.ceilingPercent ?? 0.05;
  const floorPercent = p.floorPercent ?? 0.025;

  const raw = portfolioBalance * basePercent;

  // First decumulation year: no prior spending to clamp against
  if (crossYearState.priorYearSpending === null) {
    const spending = roundToCents(raw);
    return {
      projectedExpenses: spending,
      action: null,
      updatedState: { priorYearSpending: spending },
    };
  }

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
    action,
    updatedState: { priorYearSpending: spending },
  };
}
