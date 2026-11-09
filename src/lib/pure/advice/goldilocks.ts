/**
 * Money Guy's Goldilocks rule (GOLDILOCKS_RULE, lib/config/milestones.ts):
 * how long to dollar-cost average a lump sum, by its share of the money
 * already invested. Pure.
 */
import { GOLDILOCKS_RULE } from "@/lib/config/milestones";

export type GoldilocksPlan = {
  /** The lump sum as a share of invested assets. */
  share: number;
  /** 0 = invest it at once; otherwise the months to spread it over. */
  months: number;
};

/** null when there's nothing to compare against (no invested assets) or
 *  no money coming in. */
export function goldilocksPlan(
  amount: number,
  investedAssets: number,
): GoldilocksPlan | null {
  if (!(amount > 0) || !(investedAssets > 0)) return null;
  const share = amount / investedAssets;
  const r = GOLDILOCKS_RULE;
  if (share < r.lumpSumBelow) return { share, months: 0 };
  // Whole 5% steps past 10% (a hair of float slack so exactly 15% is a step).
  const steps = Math.floor((share - r.lumpSumBelow) / r.stepShare + 1e-9);
  return { share, months: Math.min(r.maxMonths, r.startMonths + steps) };
}

/** Invested at the start of `year`: the latest prior year's end, every account incl.
 *  Portfolio. undefined when the projection starts at or after `year`. */
export function investedAtStartOf(
  rows: readonly { year: number; allAccountsBalance: number }[],
  year: number,
): number | undefined {
  let found: number | undefined;
  for (const r of rows) if (r.year < year) found = r.allAccountsBalance;
  return found;
}
