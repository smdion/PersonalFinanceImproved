/** Months with 3 biweekly paydays instead of 2, walked from `anchorPayDate`
 *  (a known real payday), and whether that extra check stays budget income. */
import { MS_PER_DAY } from "../../constants";
import { alignPaydayOnOrAfter } from "./pay-periods-in-year";

/**
 * Finds months with 3 paydays (only applies to biweekly pay).
 *
 * Biweekly = 26 paychecks/year, but 12 months × 2 = 24. The extra 2 paychecks land in months
 * that happen to have 3 Fridays (or whatever the payday is). These "extra paycheck months" are
 * useful for budgeting — users can plan to save or invest the 3rd check.
 *
 * Algorithm: starting from a known anchor payday, walk forward in 14-day increments through the
 * calendar year, counting how many paydays fall in each month. Months with ≥ 3 are reported.
 */
export function findExtraPaycheckMonths(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
): string[] {
  if (payPeriod !== "biweekly") return [];

  const year = asOfDate.getFullYear();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Use UTC throughout to avoid timezone-induced off-by-one errors.
  // Anchor dates are parsed from date strings (UTC midnight), so all arithmetic must stay in UTC.
  const msPerDay = MS_PER_DAY;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

  // Count paydays per month for the year (using UTC month)
  const paydayCounts = new Array(12).fill(0) as number[];
  const december31 = new Date(Date.UTC(year, 11, 31));
  while (payday <= december31) {
    paydayCounts[payday.getUTCMonth()]!++;
    payday = new Date(payday.getTime() + 14 * msPerDay);
  }

  const months: string[] = [];
  for (let m = 0; m < 12; m++) {
    if ((paydayCounts[m] ?? 0) >= 3) {
      months.push(monthNames[m]!);
    }
  }

  return months;
}

/**
 * Returns YYYY-MM-01 date strings for every extra-paycheck month (3 paydays)
 * within the window [asOfDate, asOfDate + horizonMonths). Only biweekly pay
 * produces extra paycheck months; all other schedules return [].
 */
export function getExtraPaycheckMonthKeys(
  anchorPayDate: Date,
  payPeriod: string,
  asOfDate: Date,
  horizonMonths: number,
): string[] {
  if (payPeriod !== "biweekly") return [];

  const msPerDay = MS_PER_DAY;
  const results: string[] = [];

  // Walk years covered by the horizon, collecting 3-payday months via payday counting.
  const startYear = asOfDate.getUTCFullYear();
  const endDate = new Date(
    Date.UTC(
      asOfDate.getUTCFullYear(),
      asOfDate.getUTCMonth() + horizonMonths,
      1,
    ),
  );
  const endYear = endDate.getUTCFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const december31 = new Date(Date.UTC(year, 11, 31));

    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

    const counts = new Array(12).fill(0) as number[];
    while (payday <= december31) {
      counts[payday.getUTCMonth()]!++;
      payday = new Date(payday.getTime() + 14 * msPerDay);
    }
    for (let m = 0; m < 12; m++) {
      if ((counts[m] ?? 0) >= 3) {
        const key = `${year}-${String(m + 1).padStart(2, "0")}-01`;
        const keyDate = new Date(Date.UTC(year, m, 1));
        if (
          keyDate >=
            new Date(
              Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1),
            ) &&
          keyDate < endDate
        ) {
          results.push(key);
        }
      }
    }
  }
  return results;
}

/**
 * Whether a job's extra (3rd biweekly) paycheck currently lands in Budget
 * mode (stays as regular income) rather than Savings mode (routed per
 * `rules`/`overrides`). No rules configured yet defaults to Budget mode —
 * `enabled` only has meaning once there's something to enable/disable.
 * Loosely typed (not `ExtraPaycheckRoutingData`) so calculator code never
 * needs to import from a schema file — see CONTRIBUTING.md's pure-calculator rule.
 */
export function isExtraPaycheckBudgetMode(
  routing: { rules?: unknown[]; enabled?: boolean } | null | undefined,
): boolean {
  const rules = routing?.rules ?? [];
  return rules.length === 0 ? true : routing?.enabled === false;
}
