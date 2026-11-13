/** Percentage routing's shares: each account's split as its part of the
 *  year's resolved splits, so a year draws its need whatever they sum to. */
import type { AccountCategory } from "../../../config/account-types";
import {
  buildCategoryRecord,
  getAllCategories,
} from "../../../config/account-types";
import { formatPercent } from "../../../utils/percent";

/** Off 100% by less than this is rounding in the stored splits. */
const SUM_TOLERANCE = 1e-6;

/** Whole percents as such; anything else to the hundredth. */
const percent = (share: number) =>
  formatPercent(share, Number.isInteger(+(share * 100).toFixed(6)) ? 0 : 2);

/** Each account's share of the year's need: need × split / Σsplit, a
 *  negative or missing split counted as 0, each correction a warning (the
 *  response says how splits off 100% were read). All at 0%: all shares 0. */
export function splitShares(
  splits: Record<AccountCategory, number>,
  warnings: string[],
): Record<AccountCategory, number> {
  const counted = buildCategoryRecord(() => 0);
  for (const c of getAllCategories())
    counted[c] = splits[c] > 0 ? splits[c] : 0;
  const negative = getAllCategories().filter((c) => splits[c] < 0);
  if (negative.length > 0) {
    warnings.push(
      `Withdrawal split below 0% for ${negative.join(", ")} counts as 0%.`,
    );
  }
  const sum = getAllCategories().reduce((t, c) => t + counted[c], 0);
  if (Math.abs(sum - 1) <= SUM_TOLERANCE) return counted;
  if (sum <= 0) {
    warnings.push(
      "Withdrawal splits sum to 0%: this year is drawn from every account in proportion to what each can give.",
    );
    return counted;
  }
  warnings.push(
    `Withdrawal splits sum to ${percent(sum)}, not 100%: each account gives its split's part of the total, so the year draws its need.`,
  );
  for (const c of getAllCategories()) counted[c] /= sum;
  return counted;
}
