/**
 * A finalized year with no performance rows reads its portfolio by type from
 * the year-end columns `net_worth_annual` stores (FALLBACKS § Absent states,
 * "Finalized year-end history"): finalized history is stored as-is.
 */
import { getAllCategories, getDisplayGroup } from "@/lib/config/account-types";
import type { DisplayGroup } from "@/lib/config/account-types.types";
import { sumBy } from "@/lib/utils/math";
import { toNumber } from "@/lib/utils/numbers";

/** The year-end portfolio columns per display group (`retirementTotal`
 *  holds the 401k, 403b and IRA combined). */
const YEAR_END_PORTFOLIO_COLUMNS = {
  retirement: ["retirementTotal"],
  hsa: ["hsa"],
  taxable: ["ltBrokerage", "espp", "rBrokerage"],
} as const satisfies Record<DisplayGroup, readonly string[]>;

type YearEndColumn = (typeof YEAR_END_PORTFOLIO_COLUMNS)[DisplayGroup][number];

/** A finalized year's portfolio by type from its stored columns: each
 *  display group's columns under the group's first category in config order. */
export function storedPortfolioByType(
  row: Record<YearEndColumn, string | null>,
): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const [group, columns] of Object.entries(YEAR_END_PORTFOLIO_COLUMNS)) {
    const category = getAllCategories().find(
      (c) => getDisplayGroup(c) === group,
    );
    if (category === undefined)
      throw new Error(`No account category shows in the ${group} group`);
    byType[category] = sumBy(columns, (column) => toNumber(row[column]));
  }
  return byType;
}
