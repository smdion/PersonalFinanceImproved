/** The year's checks one by one, withheld so far, and blended year totals. */
import type {
  PaycheckInput,
  PaycheckResult,
  BlendedAnnualTotals,
  PeriodBreakdown,
  BonusEstimate,
} from "./paycheck.types";
import { roundToCents, sumBy } from "../../utils/math";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { findBonusPeriod } from "./bonus-check";
import { yearTotals } from "./year-totals";

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

/**
 * Federal and FICA withheld on the year's first `periods` regular checks, per the year schedule
 * (full SS until the wage base, unlike the per-check average). Excludes bonus withholding.
 */
export function withheldThroughPeriod(
  schedule: readonly PeriodBreakdown[],
  periods: number,
): { federal: number; fica: number } {
  const { federal, fica } = yearTotals(schedule, 1, periods);
  return { federal, fica };
}

/**
 * The household's withholding so far this year: each current job's
 * regular checks to date (withheldThroughPeriod) plus what jobs that ended
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
 * $0) with the bonus in its month. Federal withholding is constant per period.
 */
export function buildYearSchedule(
  input: PaycheckInput,
  gross: number,
  totalPreTax: number,
  federalWithholding: number,
  ficaBase: number,
  totalPostTax: number,
  bonusEstimate: BonusEstimate,
  /** Paydays this year before the job started — empty rows. */
  beforeStart = 0,
): PeriodBreakdown[] {
  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const ssRate = input.taxBrackets.socialSecurityRate;
  const medRate = input.taxBrackets.medicareRate;
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;

  // Determine which period gets the bonus (if bonusMonth is set)
  const bonusPeriodNum =
    input.bonusMonth != null && bonusEstimate.bonusGross > 0
      ? findBonusPeriod(
          input.asOfDate,
          input.payPeriod,
          input.anchorPayDate,
          input.bonusMonth,
          input.bonusDayOfMonth,
        )
      : null;

  const schedule: PeriodBreakdown[] = [];
  let ytdFicaBase = 0; // Running total of FICA-taxable earnings

  for (let p = 1; p <= periodsPerYear; p++) {
    if (p <= beforeStart) {
      // Not this job's check (a bonus dated before the start isn't either).
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
        beforeStart: true,
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
      input.taxBrackets.medicareAdditionalRate *
        Math.max(
          0,
          Math.min(
            periodFicaBase,
            ytdFicaBase - input.taxBrackets.medicareAdditionalThreshold,
          ),
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

/** A salary segment with a pre-computed paycheck at that salary rate. */
export type SalarySegment = {
  salary: number;
  effectiveDate: string | null;
  /** 1-indexed first period at this salary. */
  startPeriod: number;
  /** 1-indexed last period at this salary (inclusive). */
  endPeriod: number;
  /** Full paycheck result computed at this salary rate. */
  paycheck: PaycheckResult;
};

/**
 * Blended annual totals across a salary timeline: walks periods taking each from its segment's
 * PaycheckResult, carrying cumulative FICA base so the SS cap holds across salary changes.
 */
export function calculateBlendedAnnual(
  segments: SalarySegment[],
  taxBrackets: {
    socialSecurityWageBase: number;
    socialSecurityRate: number;
    medicareRate: number;
  },
): BlendedAnnualTotals {
  if (segments.length === 0) {
    return {
      gross: 0,
      federalWithholding: 0,
      ficaSS: 0,
      ficaMedicare: 0,
      preTaxDeductions: 0,
      postTaxDeductions: 0,
      netPay: 0,
      blendedSalary: 0,
      segments: [],
    };
  }

  const ssWageBase = taxBrackets.socialSecurityWageBase;
  const ssRate = taxBrackets.socialSecurityRate;
  const medRate = taxBrackets.medicareRate;

  let totalGross = 0;
  let totalFederalWithholding = 0;
  let totalFicaSS = 0;
  let totalFicaMedicare = 0;
  let totalPreTax = 0;
  let totalPostTax = 0;
  let ytdFicaBase = 0;

  for (const seg of segments) {
    const pc = seg.paycheck;
    // Per-period values from this segment's paycheck (at this salary rate)
    const segGross = pc.gross;
    const segFederal = pc.federalWithholding;
    const segPreTax = sumBy(pc.preTaxDeductions, (d) => d.amount);
    const segPostTax = sumBy(pc.postTaxDeductions, (d) => d.amount);
    const segFicaBase = pc.ficaWages;

    for (let p = seg.startPeriod; p <= seg.endPeriod; p++) {
      totalGross += segGross;
      totalFederalWithholding += segFederal;
      totalPreTax += segPreTax;
      totalPostTax += segPostTax;

      // FICA: track cumulative base for SS cap
      ytdFicaBase += segFicaBase;
      const periodSS = computeSSWithholding(
        segFicaBase,
        ytdFicaBase,
        ssWageBase,
        ssRate,
      );
      const periodMed = segFicaBase * medRate;

      totalFicaSS += periodSS;
      totalFicaMedicare += periodMed;
    }
  }

  const totalNet =
    totalGross -
    totalPreTax -
    totalFederalWithholding -
    totalFicaSS -
    totalFicaMedicare -
    totalPostTax;

  const totalPeriods = sumBy(
    segments,
    (seg) => seg.endPeriod - seg.startPeriod + 1,
  );
  const blendedSalary =
    totalPeriods > 0
      ? sumBy(
          segments,
          (seg) => seg.salary * (seg.endPeriod - seg.startPeriod + 1),
        ) / totalPeriods
      : 0;

  return {
    gross: roundToCents(totalGross),
    federalWithholding: roundToCents(totalFederalWithholding),
    ficaSS: roundToCents(totalFicaSS),
    ficaMedicare: roundToCents(totalFicaMedicare),
    preTaxDeductions: roundToCents(totalPreTax),
    postTaxDeductions: roundToCents(totalPostTax),
    netPay: roundToCents(totalNet),
    blendedSalary: roundToCents(blendedSalary),
    segments: segments.map((seg) => ({
      salary: seg.salary,
      periods: seg.endPeriod - seg.startPeriod + 1,
      effectiveDate: seg.effectiveDate,
    })),
  };
}
