/** The bonus check on the year schedule: which check pays it. */
import { MS_PER_DAY } from "../../constants";
import { alignPaydayOnOrAfter } from "./pay-periods-in-year";

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
