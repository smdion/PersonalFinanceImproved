/** Months with 3 biweekly paydays instead of 2, walked from `anchorPayDate`
 *  (a known real payday), and whether that extra check stays budget income. */
import { MS_PER_DAY } from "../../constants";
import { alignPaydayOnOrAfter } from "./pay-periods-in-year";

/**
 * Months with 3 paydays (biweekly only: 26 checks vs 24), found by walking 14-day steps
 * from a known anchor payday through the calendar year.
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
 * `YYYY-MM-01` keys of the 3-payday months (biweekly only) in [fromMonth,
 * fromMonth + horizonMonths). `fromMonth` is a household month key (`monthKey`).
 */
export function getExtraPaycheckMonthKeys(
  anchorPayDate: Date,
  payPeriod: string,
  fromMonth: string,
  horizonMonths: number,
): string[] {
  if (payPeriod !== "biweekly") return [];

  const msPerDay = MS_PER_DAY;
  const results: string[] = [];

  // Walk years covered by the horizon, collecting 3-payday months via payday counting.
  const startYear = Number(fromMonth.slice(0, 4));
  const startMonthIndex = Number(fromMonth.slice(5, 7)) - 1;
  const startDate = new Date(Date.UTC(startYear, startMonthIndex, 1));
  const endDate = new Date(
    Date.UTC(startYear, startMonthIndex + horizonMonths, 1),
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
        if (keyDate >= startDate && keyDate < endDate) {
          results.push(key);
        }
      }
    }
  }
  return results;
}

/**
 * Whether a job's extra (3rd biweekly) paycheck stays regular income (Budget mode) rather than
 * routed per `rules`/`overrides`. No rules means Budget mode. Loosely typed so calculator code
 * never imports a schema file (CONTRIBUTING.md's pure-calculator rule).
 */
export function isExtraPaycheckBudgetMode(
  routing: { rules?: unknown[]; enabled?: boolean } | null | undefined,
): boolean {
  const rules = routing?.rules ?? [];
  return rules.length === 0 ? true : routing?.enabled === false;
}
