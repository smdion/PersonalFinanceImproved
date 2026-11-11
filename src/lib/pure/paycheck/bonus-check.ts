/** The bonus check on the year schedule: which check pays it. */
import type { PaycheckInput } from "./paycheck.types";
import { MS_PER_DAY } from "../../constants";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { alignPaydayOnOrAfter } from "./pay-periods-in-year";
import { bonusAfterEnd } from "./job-last-check";

/**
 * Finds the pay period that contains the bonus pay date.
 * When bonusDayOfMonth is provided, matches the specific date within the month.
 * Otherwise falls back to the first pay period of the given month.
 */
export function findBonusPeriod(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
  bonusMonth: number,
  bonusDayOfMonth: number | null,
): number {
  const year = asOfDate.getFullYear();
  const msPerDay = MS_PER_DAY;
  const targetMonth = bonusMonth - 1; // 0-indexed
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const targetDay =
    bonusDayOfMonth != null ? Math.min(bonusDayOfMonth, lastDay) : null;
  const bonusDate =
    targetDay != null ? new Date(Date.UTC(year, targetMonth, targetDay)) : null;

  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const interval = payPeriod === "biweekly" ? 14 : 7;
    const jan1 = new Date(Date.UTC(year, 0, 1));
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, interval);
    // Dated before the year's first payday: that first check pays it.
    if (bonusDate && bonusDate < payday) return 1;

    let periodNum = 0;
    const december31 = new Date(Date.UTC(year, 11, 31));
    while (payday <= december31) {
      periodNum++;
      if (bonusDate) {
        const nextPayday = new Date(payday.getTime() + interval * msPerDay);
        if (bonusDate >= payday && bonusDate < nextPayday) return periodNum;
      } else {
        if (payday.getUTCMonth() === targetMonth) return periodNum;
      }
      payday = new Date(payday.getTime() + interval * msPerDay);
    }
    return periodNum; // fallback to last period
  }

  if (payPeriod === "semimonthly") {
    // Paydays the 1st and the 15th, as the pay calendar counts them
    if (targetDay != null && targetDay >= 15) {
      return targetMonth * 2 + 2; // second pay period of the month
    }
    return targetMonth * 2 + 1; // first pay period of the month
  }

  if (payPeriod === "monthly") {
    return targetMonth + 1;
  }

  return 1;
}

/**
 * The schedule's check that pays the bonus: its dated one; an undated bonus, or one dated
 * past the last row, the last (paid after the regular checks). Null with no bonus, or one
 * after the job's last check this year (not its pay).
 */
export function bonusCheckNumber(
  input: PaycheckInput,
  bonusGross: number,
): number | null {
  if (bonusGross <= 0) return null;
  const last = getPeriodsPerYear(input.payPeriod);
  const check =
    input.bonusMonth == null
      ? last
      : Math.min(
          last,
          findBonusPeriod(
            input.asOfDate,
            input.payPeriod,
            input.anchorPayDate,
            input.bonusMonth,
            input.bonusDayOfMonth,
          ),
        );
  return bonusAfterEnd(input, check, last) ? null : check;
}

/**
 * Where the bonus falls against the job's checks this year: the pay period it's dated in
 * (for display; null undated or outside the job), and whether it's dated before the job's
 * start, after its last check, or undated. Outside the job, the schedule leaves it out too.
 */
export function bonusOnSchedule(
  input: PaycheckInput,
  bonusGross: number,
  beforeStart: number,
) {
  const found =
    input.bonusMonth != null && bonusGross > 0
      ? findBonusPeriod(
          input.asOfDate,
          input.payPeriod,
          input.anchorPayDate,
          input.bonusMonth,
          input.bonusDayOfMonth,
        )
      : null;
  const afterEnd =
    bonusGross > 0 && bonusCheckNumber(input, bonusGross) === null;
  return {
    bonusPeriod:
      found !== null && found > beforeStart && !afterEnd ? found : null,
    bonusBeforeStart: found !== null && found <= beforeStart,
    bonusAfterEnd: afterEnd,
    bonusUndated: input.bonusMonth == null && bonusGross > 0,
  };
}
