/** The year's checks one by one, and withheld so far. */
import type {
  PaycheckInput,
  PaycheckResult,
  PeriodBreakdown,
  BonusEstimate,
} from "./paycheck.types";
import { roundToCents, sumBy } from "../../utils/math";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { bonusCheckNumber } from "./bonus-check";
import { yearTotals } from "./year-totals";
import { additionalMedicareWithheld } from "./additional-medicare";
import type { JobChecks } from "./job-last-check";

/**
 * Social Security withholding for one pay period, given the wage base cap.
 * Three cases: fully under the cap, fully over it (YTD already exceeded the
 * cap before this period), or straddling it (this period crosses the cap).
 */
function computeSSWithholding(
  periodFicaBase: number,
  ytdFicaBaseAfter: number,
  ssWageBase: number,
  ssRate: number,
): number {
  if (ytdFicaBaseAfter <= ssWageBase) {
    return periodFicaBase * ssRate;
  }
  if (ytdFicaBaseAfter - periodFicaBase >= ssWageBase) {
    return 0;
  }
  const remainingBase = ssWageBase - (ytdFicaBaseAfter - periodFicaBase);
  return remainingBase * ssRate;
}

/** Federal and FICA withheld on the schedule's first `periods` checks (full SS until the wage
 *  base, unlike the per-check average), a bonus paid on one of them included. */
export function withheldThroughPeriod(
  schedule: readonly PeriodBreakdown[],
  periods: number,
): { federal: number; fica: number } {
  const t = yearTotals(schedule, 1, periods);
  const federal = roundToCents(t.federal + t.bonusFederal);
  return { federal, fica: roundToCents(t.fica + t.bonusFica) };
}

/**
 * The household's withholding so far this year: each current job's
 * checks to date (withheldThroughPeriod) plus what jobs that ended
 * this year withheld — someone with no job now still had tax withheld.
 */
export function householdWithheldSoFar(
  people: readonly {
    paycheck: Pick<PaycheckResult, "yearSchedule" | "periodsElapsedYtd"> | null;
    endedWithheld?: { federal: number; fica: number } | null;
  }[],
): { federal: number; fica: number } {
  const parts = people.flatMap((d) => [
    ...(d.paycheck
      ? [
          withheldThroughPeriod(
            d.paycheck.yearSchedule,
            d.paycheck.periodsElapsedYtd,
          ),
        ]
      : []),
    ...(d.endedWithheld ? [d.endedWithheld] : []),
  ]);
  return {
    federal: roundToCents(sumBy(parts, (w) => w.federal)),
    fica: roundToCents(sumBy(parts, (w) => w.fica)),
  };
}

/**
 * Full-year schedule of every pay period, modeling the SS wage base cutoff (full, partial, then
 * $0) with the bonus in its month. Paydays outside the job (and a bonus dated there) are empty.
 */
export function buildYearSchedule(
  input: PaycheckInput,
  gross: number,
  totalPreTax: number,
  federalWithholding: number,
  ficaBase: number,
  totalPostTax: number,
  bonusEstimate: BonusEstimate,
  /** The job's checks this year: rows before its start and after its last check are empty. */
  { beforeStart, lastCheck }: Pick<JobChecks, "beforeStart" | "lastCheck">,
): PeriodBreakdown[] {
  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const ssRate = input.taxBrackets.socialSecurityRate;
  const medRate = input.taxBrackets.medicareRate;
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  const bonusPeriodNum = bonusCheckNumber(input, bonusEstimate.bonusGross);

  const schedule: PeriodBreakdown[] = [];
  let ytdFicaBase = 0; // Running total of FICA-taxable earnings

  for (let p = 1; p <= periodsPerYear; p++) {
    if (p <= beforeStart || p > lastCheck) {
      schedule.push({
        periodNumber: p,
        gross: 0,
        federalWithholding: 0,
        ficaSS: 0,
        ficaMedicare: 0,
        preTaxDeductions: 0,
        postTaxDeductions: 0,
        netPay: 0,
        bonusGross: 0,
        bonusWithholding: 0,
        bonusFica: 0,
        ...(p <= beforeStart ? { beforeStart: true } : { afterEnd: true }),
      });
      continue;
    }
    const isBonus = p === bonusPeriodNum;
    const periodBonusGross = isBonus ? bonusEstimate.bonusGross : 0;
    const periodBonusWithholding = isBonus
      ? bonusEstimate.bonusFederalWithholding
      : 0;

    const periodBonusFicaWages = isBonus ? bonusEstimate.bonusFicaWages : 0;
    const periodFicaBase = ficaBase + periodBonusFicaWages;
    ytdFicaBase += periodFicaBase;

    // Social Security tax: three cases based on where we are relative to the wage base cap
    const periodSS = computeSSWithholding(
      periodFicaBase,
      ytdFicaBase,
      ssWageBase,
      ssRate,
    );

    // Employers withhold Additional Medicare on an employee's Medicare
    // wages above the withholding threshold this year (IRC 3102(f)) — this
    // employer's wages only, which ytdFicaBase counts.
    const periodMed =
      periodFicaBase * medRate +
      additionalMedicareWithheld(
        input.taxBrackets,
        periodFicaBase,
        ytdFicaBase,
      );

    const regularFicaBase = ficaBase;
    const bonusFicaBase = periodBonusFicaWages;
    const totalFicaThisPeriod = periodSS + periodMed;
    // Attribute FICA proportionally between regular pay and bonus
    const bonusFicaPortion =
      isBonus && periodFicaBase > 0
        ? roundToCents(totalFicaThisPeriod * (bonusFicaBase / periodFicaBase))
        : 0;
    const regularSS =
      isBonus && periodFicaBase > 0
        ? roundToCents(periodSS * (regularFicaBase / periodFicaBase))
        : roundToCents(periodSS);
    const regularMed =
      isBonus && periodFicaBase > 0
        ? roundToCents(periodMed * (regularFicaBase / periodFicaBase))
        : roundToCents(periodMed);

    const periodNet =
      gross -
      totalPreTax -
      federalWithholding -
      regularSS -
      regularMed -
      totalPostTax;

    schedule.push({
      periodNumber: p,
      gross: roundToCents(gross),
      federalWithholding: roundToCents(federalWithholding),
      ficaSS: regularSS,
      ficaMedicare: regularMed,
      preTaxDeductions: roundToCents(totalPreTax),
      postTaxDeductions: roundToCents(totalPostTax),
      netPay: roundToCents(periodNet),
      bonusGross: roundToCents(periodBonusGross),
      bonusWithholding: roundToCents(periodBonusWithholding),
      bonusFica: roundToCents(bonusFicaPortion),
    });
  }

  return schedule;
}
