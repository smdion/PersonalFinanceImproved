/**
 * Paycheck Calculator
 *
 * Computes per-period net pay by walking through the paycheck waterfall:
 *   Gross salary ÷ periods → Pre-tax deductions → Federal withholding → FICA → Post-tax deductions → Net pay
 *
 * Key concepts:
 *   - FICA base ≠ federal taxable base. Section 125 deductions (health insurance, marked ficaExempt)
 *     reduce BOTH FICA and income tax. Non-Section-125 pre-tax deductions (401k, HSA) only reduce
 *     income tax, NOT FICA.
 *   - Federal withholding uses the IRS annualized method: multiply per-period taxable income by
 *     periods/year, look up tax in annual brackets, divide back by periods/year.
 *   - The bracket set passed in may be W-4 2(c) checked or unchecked — the tRPC layer selects the
 *     correct set based on job settings. 2(c) brackets are halved for dual-income households.
 *   - Social Security tax has a wage base cap (e.g. $176,100). Once YTD FICA base exceeds the cap,
 *     SS withholding drops to $0 for remaining periods. The year schedule models this transition.
 *   - Contribution accounts (401k, IRA, HSA, brokerage) are only included as paycheck deductions
 *     when `isPayrollDeducted` is true. IRA and brokerage contributions flow outside the paycheck.
 *   - Extra paycheck months: for biweekly pay, some months have 3 paydays instead of 2. The
 *     calculator uses `anchorPayDate` (a known real payday) to derive which months get 3 checks.
 *   - Bonus estimate uses the IRS supplemental flat rate (from input, not hardcoded) and optionally
 *     deducts payroll contributions if `includeContribInBonus` is set.
 */
import type {
  PaycheckInput,
  PaycheckResult,
  BlendedAnnualTotals,
  DeductionLine,
  PeriodBreakdown,
  BonusEstimate,
} from "./types";
import { formatPercent } from "../utils/format";
import { roundToCents, safeDivide } from "../utils/math";
import { MS_PER_DAY } from "../constants";

/** Maps pay frequency to the number of pay periods per year. */
const PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

function getPeriodsPerYear(payPeriod: string): number {
  const periods = PERIODS_PER_YEAR[payPeriod];
  if (periods === undefined) {
    throw new Error(
      `Unknown pay period "${payPeriod}". Expected: weekly, biweekly, semimonthly, or monthly.`,
    );
  }
  return periods;
}

/**
 * IRS annualized bracket lookup for federal withholding.
 *
 * Walks brackets bottom-to-top, accumulating tax on each slice of income that falls within
 * each bracket's [min, max) range. Returns the total annual tax, the marginal rate (highest
 * bracket touched), the bracket floor, and the base withholding (tax from all brackets below
 * the marginal one — useful for the IRS withholding worksheet display).
 *
 * Bracket structure: { min: lower_bound, max: upper_bound | null (for top bracket), rate: decimal }
 * Example: { min: 0, max: 11600, rate: 0.10 } means 10% on the first $11,600.
 */
function lookupFederalWithholding(
  adjustedAnnualWage: number,
  brackets: { min: number; max: number | null; rate: number }[],
): {
  annualTax: number;
  marginalRate: number;
  bracketMin: number;
  baseWithholding: number;
} {
  let annualTax = 0;
  let marginalRate = 0;
  let bracketMin = 0;
  let baseWithholding = 0;

  // First pass: find the highest bracket that applies (for marginal rate reporting)
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i]!;
    if (adjustedAnnualWage >= bracket.min) {
      marginalRate = bracket.rate;
      bracketMin = bracket.min;
      break;
    }
  }

  // Second pass: compute total tax by summing each bracket's contribution
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i]!;
    if (adjustedAnnualWage <= bracket.min) break;

    const upper =
      bracket.max !== null
        ? Math.min(adjustedAnnualWage, bracket.max)
        : adjustedAnnualWage;
    const taxableInBracket = upper - bracket.min;
    if (taxableInBracket > 0) {
      annualTax += taxableInBracket * bracket.rate;
    }
  }

  // Base withholding = total tax minus the marginal bracket's contribution
  // This matches the IRS withholding table format: "base + rate × (wage - bracket floor)"
  baseWithholding =
    annualTax - (adjustedAnnualWage - bracketMin) * marginalRate;

  return { annualTax, marginalRate, bracketMin, baseWithholding };
}

/** Pre-tax treatments: traditional 401k ('pre_tax') and HSA ('hsa') both reduce taxable income. */
function isPreTax(treatment: string): boolean {
  // lint-violation-ok: "hsa" here is the tax-treatment value (TaxTreatment enum), not an account category
  return treatment === "pre_tax" || treatment === "hsa";
}

export function calculatePaycheck(input: PaycheckInput): PaycheckResult {
  const warnings: string[] = [];

  // Range validation — catch data-entry errors before they propagate
  if (input.annualSalary < 0) {
    warnings.push("Annual salary is negative — results may be incorrect.");
  }
  if (input.annualSalary > 10_000_000) {
    warnings.push("Annual salary exceeds $10M — verify this is correct.");
  }
  if (input.bonusPercent < 0 || input.bonusPercent > 5) {
    warnings.push(
      `Bonus percent ${formatPercent(input.bonusPercent)} is outside expected range (0-500%).`,
    );
  }
  if (input.bonusMultiplier < 0 || input.bonusMultiplier > 10) {
    warnings.push(
      `Bonus multiplier ${input.bonusMultiplier}x is outside expected range (0-10x).`,
    );
  }
  for (const d of input.deductions) {
    if (d.amount < 0) {
      warnings.push(`Deduction "${d.name}" has a negative amount.`);
    }
  }

  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const gross = roundToCents(
    safeDivide(input.annualSalary, periodsPerYear, 0)!,
  );

  // ── Step 1: Classify deductions ──
  // Split all deductions into pre-tax (reduces taxable income) and post-tax (deducted after taxes).
  // Two sources of deductions:
  //   1. input.deductions — paycheck line items like health/dental/vision insurance
  //   2. input.contributionAccounts — 401k, HSA, etc. (only if isPayrollDeducted is true)
  const preTaxDeductions: DeductionLine[] = [];
  const postTaxDeductions: DeductionLine[] = [];

  // Source 1: Paycheck deductions (health insurance, disability, etc.)
  for (const d of input.deductions) {
    if (isPreTax(d.taxTreatment)) {
      preTaxDeductions.push(d);
    } else {
      postTaxDeductions.push(d);
    }
  }

  // Source 2: Payroll-deducted contribution accounts (e.g. 401k, HSA)
  // Non-payroll accounts (IRA, brokerage) are skipped — they're contributed outside the paycheck.
  // Contribution accounts are NEVER FICA-exempt. Only Section 125 health insurance
  // deductions (from input.deductions) can be FICA-exempt.
  for (const ca of input.contributionAccounts) {
    if (!ca.isPayrollDeducted) continue;
    const line: DeductionLine = {
      name: ca.name,
      amount: roundToCents(ca.perPeriodContribution),
      taxTreatment: ca.taxTreatment,
      ficaExempt: false,
    };
    if (isPreTax(ca.taxTreatment)) {
      preTaxDeductions.push(line);
    } else {
      postTaxDeductions.push(line);
    }
  }

  const totalPreTax = preTaxDeductions.reduce((s, d) => s + d.amount, 0);
  const totalPostTax = postTaxDeductions.reduce((s, d) => s + d.amount, 0);

  // ── Step 2: Compute FICA base ──
  // FICA base = gross minus ONLY FICA-exempt deductions (Section 125 health/dental/vision).
  // This is different from federal taxable gross because 401k and HSA reduce income tax but NOT FICA.
  // Only items from input.deductions can be FICA-exempt; contribution accounts never are.
  const ficaExemptFromDeductions = input.deductions
    .filter((d) => d.ficaExempt)
    .reduce((s, d) => s + d.amount, 0);
  const ficaBase = gross - ficaExemptFromDeductions;

  // ── Step 3: Federal withholding (IRS annualized method) ──
  // Federal taxable gross = gross minus ALL pre-tax deductions (401k, HSA, health insurance, etc.)
  const federalTaxableGross = gross - totalPreTax;

  // Annualize for bracket lookup, then divide result back to per-period
  const adjustedAnnualWage = federalTaxableGross * periodsPerYear;
  const { annualTax, marginalRate } = lookupFederalWithholding(
    adjustedAnnualWage,
    input.taxBrackets.brackets,
  );
  const federalWithholding = safeDivide(annualTax, periodsPerYear, 0)!;

  // ── Step 4: FICA taxes ──
  // Social Security: 6.2% (from input) on FICA base, capped at wage base (e.g. $176,100/year).
  // If the employee's YTD earnings already exceed the wage base, SS drops to $0.
  //
  // SINGLE-EMPLOYER ASSUMPTION: This calculator models one W-2 employer. Each employer
  // withholds SS independently up to the wage base — if the employee has multiple jobs,
  // total SS withheld across all employers may exceed the annual maximum. The excess is
  // recovered as a credit on the tax return (Form 1040 line 11 / Schedule 3). Multi-job
  // SS wage base coordination is not modeled here.
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  const ssRate = input.taxBrackets.socialSecurityRate;
  const annualFicaBase = ficaBase * periodsPerYear;
  let ficaSS: number;
  if (annualFicaBase <= ssWageBase) {
    // Full-year SS applies — every period pays SS
    ficaSS = ficaBase * ssRate;
  } else {
    // Some periods will hit the cap. For the "current period" display, check YTD.
    ficaSS = ficaBase * ssRate;
    if (input.ytdGrossEarnings > 0 && input.ytdGrossEarnings >= ssWageBase) {
      ficaSS = 0;
      warnings.push("SS wage base exceeded for this period");
    }
  }

  // Medicare: 1.45% (from input) on FICA base, no cap.
  // Additional Medicare Tax (0.9% above $200k) is handled in the annual tax calculator, not here.
  const ficaMedicare = ficaBase * input.taxBrackets.medicareRate;

  // ── Step 5: Net pay ──
  // Gross - pre-tax deductions - federal withholding - FICA SS - FICA Medicare - post-tax deductions
  const netPay =
    gross -
    totalPreTax -
    federalWithholding -
    ficaSS -
    ficaMedicare -
    totalPostTax;

  // ── Step 6: Bonus estimate ──
  // Uses the IRS supplemental flat rate (e.g. 22%) instead of marginal bracket rate.
  const bonusEstimate = calculateBonus(input, marginalRate);

  // ── Step 7: Extra paycheck months ──
  // For biweekly pay, 2 months per year have 3 paydays instead of 2.
  // Uses anchorPayDate directly (a known real payday) to calculate which months.
  // No payWeek shift needed — the anchor already represents the person's actual pay schedule.
  const extraPaycheckMonths = findExtraPaycheckMonths(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
  );

  // ── Step 8: Year schedule ──
  // Full year amortization of all pay periods, modeling when SS tax stops mid-year.
  // If bonusMonth is set, the bonus is injected into the correct period so SS cap timing is accurate.
  const yearSchedule = buildYearSchedule(
    input,
    gross,
    totalPreTax,
    federalWithholding,
    ficaBase,
    totalPostTax,
    bonusEstimate,
  );

  // Estimate how many pay periods have already passed this year (for UI display)
  // If ytdGrossEarnings is provided and > 0, use it; otherwise compute from the pay schedule.
  let periodsElapsedYtd: number;
  if (input.ytdGrossEarnings > 0) {
    periodsElapsedYtd = Math.round(
      safeDivide(input.ytdGrossEarnings, gross, 0)!,
    );
  } else {
    periodsElapsedYtd = countPeriodsElapsed(
      input.asOfDate,
      input.payPeriod,
      input.anchorPayDate,
    );
  }

  // ── Step 9: Next pay date and frequency label ──
  const nextPayDate = findNextPayDate(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
  );
  const payFrequencyLabel = buildPayFrequencyLabel(
    input.payPeriod,
    input.payWeek,
  );

  // Determine which period the bonus lands in (for UI display)
  const bonusPeriod =
    input.bonusMonth != null && bonusEstimate.bonusGross > 0
      ? findBonusPeriod(
          input.asOfDate,
          input.payPeriod,
          input.anchorPayDate,
          input.bonusMonth,
          input.bonusDayOfMonth,
        )
      : null;

  return {
    gross,
    preTaxDeductions,
    federalTaxableGross,
    federalWithholding: roundToCents(federalWithholding),
    ficaSS: roundToCents(ficaSS),
    ficaMedicare: roundToCents(ficaMedicare),
    postTaxDeductions,
    netPay: roundToCents(netPay),
    bonusEstimate,
    bonusPeriod,
    extraPaycheckMonths,
    yearSchedule,
    periodsPerYear,
    periodsElapsedYtd,
    nextPayDate,
    payFrequencyLabel,
    warnings,
  };
}

/**
 * Estimates net bonus pay using the IRS supplemental flat withholding method.
 *
 * Bonus gross = salary × bonus% × (months worked in bonus year / 12).
 * Federal withholding uses the supplemental flat rate (e.g. 22%), NOT the marginal bracket rate.
 * FICA is applied at full rates (SS + Medicare). SS wage base cap is not checked here — this is
 * a rough estimate; actual cap depends on when the bonus is paid relative to YTD earnings.
 *
 * If `includeContribInBonus` is true, payroll-deducted contributions (e.g. 401k) are subtracted
 * from the bonus net. This matches employers who withhold retirement contributions from bonuses.
 */
function calculateBonus(
  input: PaycheckInput,
  _marginalRate: number,
): BonusEstimate {
  if (input.bonusPercent <= 0 && input.bonusOverride === null) {
    return {
      bonusGross: 0,
      bonusNet: 0,
      bonusFederalWithholding: 0,
      bonusFica: 0,
      bonusContributions: 0,
    };
  }

  // If bonus_override is set on the job, use that value directly as gross bonus.
  // Otherwise: salary × bonus_percent × bonus_multiplier × (months_in_bonus_year / 12).
  const bonusGross =
    input.bonusOverride !== null
      ? roundToCents(input.bonusOverride)
      : roundToCents(
          input.annualSalary *
            input.bonusPercent *
            (input.bonusMultiplier ?? 1) *
            (input.monthsInBonusYear / 12),
        );

  // IRS supplemental flat rate (from input — typically 22% for income under $1M)
  const bonusFederalWithholding = roundToCents(
    bonusGross * input.supplementalTaxRate,
  );

  // FICA on bonus — respect SS wage base cap using YTD salary earnings
  const ssRate = input.taxBrackets.socialSecurityRate;
  const medRate = input.taxBrackets.medicareRate;
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  // YTD salary already subject to SS; only tax bonus up to remaining cap room
  const ytdSalaryForSS = Math.min(input.annualSalary, ssWageBase);
  const ssCapRoom = Math.max(0, ssWageBase - ytdSalaryForSS);
  const bonusSsTaxable = Math.min(bonusGross, ssCapRoom);
  const bonusFicaSS = roundToCents(bonusSsTaxable * ssRate);
  const bonusFicaMed = roundToCents(bonusGross * medRate);
  const bonusFica = bonusFicaSS + bonusFicaMed;

  // Optionally deduct payroll contributions (e.g. 401k) from bonus paycheck
  let bonusContributions = 0;
  if (input.includeContribInBonus) {
    for (const ca of input.contributionAccounts) {
      if (ca.isPayrollDeducted) {
        bonusContributions += ca.perPeriodContribution;
      }
    }
  }

  const bonusNet = roundToCents(
    bonusGross - bonusFederalWithholding - bonusFica - bonusContributions,
  );

  return {
    bonusGross,
    bonusNet,
    bonusFederalWithholding,
    bonusFica,
    bonusContributions,
  };
}

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
function findExtraPaycheckMonths(
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
  let payday = new Date(anchorPayDate);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  while (payday > jan1) {
    payday = new Date(payday.getTime() - 14 * msPerDay);
  }
  while (payday < jan1) {
    payday = new Date(payday.getTime() + 14 * msPerDay);
  }

  // Count paydays per month for the year (using UTC month)
  const paydayCounts = new Array(12).fill(0) as number[];
  const dec31 = new Date(Date.UTC(year, 11, 31));
  while (payday <= dec31) {
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
 * Count how many pay periods have occurred between Jan 1 and asOfDate for the current year.
 * Uses the same anchor-payday walking logic as findExtraPaycheckMonths.
 */
export function countPeriodsElapsed(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
): number {
  const year = asOfDate.getUTCFullYear();
  const msPerDay = MS_PER_DAY;
  // Use UTC to avoid timezone issues with date-only strings
  const jan1 = new Date(Date.UTC(year, 0, 1));

  if (payPeriod === "biweekly") {
    let payday = new Date(anchorPayDate);
    while (payday > jan1) payday = new Date(payday.getTime() - 14 * msPerDay);
    while (payday < jan1) payday = new Date(payday.getTime() + 14 * msPerDay);

    let count = 0;
    while (payday <= asOfDate) {
      count++;
      payday = new Date(payday.getTime() + 14 * msPerDay);
    }
    return count;
  }

  if (payPeriod === "semimonthly") {
    let count = 0;
    for (let m = 0; m <= asOfDate.getUTCMonth(); m++) {
      const first = new Date(Date.UTC(year, m, 1));
      const fifteenth = new Date(Date.UTC(year, m, 15));
      if (first <= asOfDate) count++;
      if (fifteenth <= asOfDate) count++;
    }
    return count;
  }

  if (payPeriod === "weekly") {
    let payday = new Date(anchorPayDate);
    while (payday > jan1) payday = new Date(payday.getTime() - 7 * msPerDay);
    while (payday < jan1) payday = new Date(payday.getTime() + 7 * msPerDay);

    let count = 0;
    while (payday <= asOfDate) {
      count++;
      payday = new Date(payday.getTime() + 7 * msPerDay);
    }
    return count;
  }

  if (payPeriod === "monthly") {
    return asOfDate.getUTCMonth() + 1;
  }

  return 0;
}

/**
 * Finds the pay period that contains the bonus pay date.
 * When bonusDayOfMonth is provided, matches the specific date within the month.
 * Otherwise falls back to the first pay period of the given month.
 */
function findBonusPeriod(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
  bonusMonth: number,
  bonusDayOfMonth: number | null,
): number {
  const year = asOfDate.getFullYear();
  const msPerDay = MS_PER_DAY;
  const targetMonth = bonusMonth - 1; // 0-indexed
  // Clamp day to valid range for target month
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const targetDay =
    bonusDayOfMonth != null ? Math.min(bonusDayOfMonth, lastDay) : null;
  const bonusDate =
    targetDay != null ? new Date(Date.UTC(year, targetMonth, targetDay)) : null;

  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const interval = payPeriod === "biweekly" ? 14 : 7;
    let payday = new Date(anchorPayDate);
    const jan1 = new Date(Date.UTC(year, 0, 1));
    while (payday > jan1)
      payday = new Date(payday.getTime() - interval * msPerDay);
    while (payday < jan1)
      payday = new Date(payday.getTime() + interval * msPerDay);

    let periodNum = 0;
    const dec31 = new Date(Date.UTC(year, 11, 31));
    while (payday <= dec31) {
      periodNum++;
      if (bonusDate) {
        // Find the period whose window contains the bonus date
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
    // Periods: 1st and 16th of each month
    if (targetDay != null && targetDay >= 16) {
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
 * Builds a full-year paycheck schedule showing every pay period's breakdown.
 *
 * The main purpose is to model the Social Security wage base cap transition accurately:
 * early periods pay full SS tax, one period may be partial, and remaining periods pay $0.
 * This lets the UI show exactly when the employee's take-home pay increases mid-year.
 *
 * If bonusMonth is set, the bonus gross is injected into the matching period so the
 * SS wage base cap is hit earlier (or later) depending on bonus timing.
 *
 * Federal withholding and Medicare are constant across all periods (Medicare has no cap).
 */
function buildYearSchedule(
  input: PaycheckInput,
  gross: number,
  totalPreTax: number,
  federalWithholding: number,
  ficaBase: number,
  totalPostTax: number,
  bonusEstimate: BonusEstimate,
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
    const isBonus = p === bonusPeriodNum;
    const periodBonusGross = isBonus ? bonusEstimate.bonusGross : 0;
    const periodBonusWithholding = isBonus
      ? bonusEstimate.bonusFederalWithholding
      : 0;

    // FICA base for this period includes bonus gross (bonus is FICA-taxable)
    const periodFicaBase = ficaBase + periodBonusGross;
    ytdFicaBase += periodFicaBase;

    // Social Security tax: three cases based on where we are relative to the wage base cap
    let periodSS: number;
    if (ytdFicaBase <= ssWageBase) {
      periodSS = periodFicaBase * ssRate;
    } else if (ytdFicaBase - periodFicaBase >= ssWageBase) {
      periodSS = 0;
    } else {
      const remainingBase = ssWageBase - (ytdFicaBase - periodFicaBase);
      periodSS = remainingBase * ssRate;
    }

    const periodMed = periodFicaBase * medRate;

    // Split FICA between regular and bonus portions for display
    const regularFicaBase = ficaBase;
    const bonusFicaBase = periodBonusGross;
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

/**
 * Finds the next upcoming pay date after asOfDate.
 *
 * For biweekly/weekly: walks forward from the anchor payday in the appropriate interval.
 * For semimonthly: next 1st or 15th.
 * For monthly: next 1st.
 */
function findNextPayDate(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: Date,
): string {
  const msPerDay = MS_PER_DAY;

  if (payPeriod === "biweekly" || payPeriod === "weekly") {
    const interval = payPeriod === "biweekly" ? 14 : 7;
    let payday = new Date(anchorPayDate);
    // Walk backward past asOfDate, then forward to find first date > asOfDate
    while (payday > asOfDate)
      payday = new Date(payday.getTime() - interval * msPerDay);
    while (payday <= asOfDate)
      payday = new Date(payday.getTime() + interval * msPerDay);
    return payday.toISOString().slice(0, 10);
  }

  if (payPeriod === "semimonthly") {
    const y = asOfDate.getUTCFullYear();
    const m = asOfDate.getUTCMonth();
    const d = asOfDate.getUTCDate();
    // Pay dates are 1st and 15th
    if (d < 1) return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    if (d < 15) return new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 10);
    // Next month's 1st
    return new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  }

  if (payPeriod === "monthly") {
    const y = asOfDate.getUTCFullYear();
    const m = asOfDate.getUTCMonth();
    const d = asOfDate.getUTCDate();
    if (d < 1) return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  }

  // Fallback
  return new Date(asOfDate.getTime() + 14 * msPerDay)
    .toISOString()
    .slice(0, 10);
}

/** Builds a human-readable pay frequency label including payWeek info. */
function buildPayFrequencyLabel(
  payPeriod: string,
  payWeek: "even" | "odd" | "na",
): string {
  const labels: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Biweekly",
    semimonthly: "Semi-Monthly (1st & 15th)",
    monthly: "Monthly",
  };
  const base = labels[payPeriod] ?? payPeriod;
  if (payPeriod === "biweekly" && payWeek !== "na") {
    return `${base} (${payWeek === "even" ? "Even" : "Odd"} Weeks)`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Salary Timeline → Period Mapping
// ---------------------------------------------------------------------------

/**
 * Map a salary timeline (date-based changes) to period-based segments.
 * Returns which pay periods use which salary rate.
 *
 * Each salary change takes effect on the first pay period whose pay date
 * falls on or after the change's effective date.
 */
export function mapSalaryTimelineToPeriods(
  timeline: { salary: number; effectiveDate: string | null }[],
  payPeriod: string,
  anchorPayDate: Date,
  year: number,
): {
  salary: number;
  effectiveDate: string | null;
  startPeriod: number;
  endPeriod: number;
}[] {
  const periodsPerYear = getPeriodsPerYear(payPeriod);
  if (timeline.length === 0) return [];
  if (timeline.length === 1) {
    return [
      {
        salary: timeline[0]!.salary,
        effectiveDate: timeline[0]!.effectiveDate,
        startPeriod: 1,
        endPeriod: periodsPerYear,
      },
    ];
  }

  // Build a list of pay dates for the year
  const payDates: Date[] = [];
  const yearStart = new Date(`${year}-01-01T00:00:00`);
  const yearEnd = new Date(`${year}-12-31T23:59:59`);

  if (payPeriod === "monthly") {
    for (let m = 0; m < 12; m++) {
      payDates.push(new Date(year, m, 1));
    }
  } else if (payPeriod === "semimonthly") {
    for (let m = 0; m < 12; m++) {
      payDates.push(new Date(year, m, 1));
      payDates.push(new Date(year, m, 15));
    }
  } else {
    // Weekly or biweekly: walk from anchor
    const interval = payPeriod === "weekly" ? 7 : 14;
    const anchorMs = anchorPayDate.getTime();
    const startMs = yearStart.getTime();
    const endMs = yearEnd.getTime();

    // Find the first pay date on or after Jan 1
    let current = anchorMs;
    if (current > startMs) {
      while (current - interval * MS_PER_DAY >= startMs) {
        current -= interval * MS_PER_DAY;
      }
    } else {
      while (current < startMs) {
        current += interval * MS_PER_DAY;
      }
    }

    while (current <= endMs && payDates.length < periodsPerYear) {
      payDates.push(new Date(current));
      current += interval * MS_PER_DAY;
    }
  }

  // Sort timeline changes by date (skip the first entry which has null effectiveDate = start of year)
  const changes = timeline
    .filter((t) => t.effectiveDate !== null)
    .map((t) => ({
      salary: t.salary,
      date: new Date(t.effectiveDate + "T00:00:00"),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // For each pay period, determine which salary is active
  const periodSalaries: { salary: number; effectiveDate: string | null }[] = [];
  let currentSalary = timeline[0]!.salary;
  let currentEffDate = timeline[0]!.effectiveDate;
  let changeIdx = 0;

  for (const payDate of payDates) {
    // Advance through changes that have taken effect by this pay date
    while (changeIdx < changes.length && changes[changeIdx]!.date <= payDate) {
      currentSalary = changes[changeIdx]!.salary;
      currentEffDate = timeline[changeIdx + 1]?.effectiveDate ?? null;
      changeIdx++;
    }
    periodSalaries.push({
      salary: currentSalary,
      effectiveDate: currentEffDate,
    });
  }

  // Compress into segments (consecutive periods at the same salary)
  const segments: {
    salary: number;
    effectiveDate: string | null;
    startPeriod: number;
    endPeriod: number;
  }[] = [];
  let segStart = 1;
  let segSalary = periodSalaries[0]!.salary;
  let segEffDate = periodSalaries[0]!.effectiveDate;

  for (let i = 1; i < periodSalaries.length; i++) {
    if (periodSalaries[i]!.salary !== segSalary) {
      segments.push({
        salary: segSalary,
        effectiveDate: segEffDate,
        startPeriod: segStart,
        endPeriod: i,
      });
      segStart = i + 1;
      segSalary = periodSalaries[i]!.salary;
      segEffDate = periodSalaries[i]!.effectiveDate;
    }
  }
  segments.push({
    salary: segSalary,
    effectiveDate: segEffDate,
    startPeriod: segStart,
    endPeriod: periodSalaries.length,
  });

  return segments;
}

// ---------------------------------------------------------------------------
// Blended Annual Calculator
// ---------------------------------------------------------------------------

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
 * Compute blended annual totals from a salary timeline with mid-year changes.
 *
 * Each segment includes a full PaycheckResult computed at that salary rate (the router
 * handles rebuilding contribution accounts per salary). This function walks periods
 * sequentially, taking per-period values from the correct segment, and tracks cumulative
 * FICA base for correct SS cap transitions across salary changes.
 *
 * Pure function — no DB, no side effects.
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
      actualYtdContributions: null,
      actualYtdEmployerMatch: null,
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
    const segPreTax = pc.preTaxDeductions.reduce((s, d) => s + d.amount, 0);
    const segPostTax = pc.postTaxDeductions.reduce((s, d) => s + d.amount, 0);
    // FICA base: gross minus only FICA-exempt deductions (same logic as calculatePaycheck)
    const ficaExempt = pc.preTaxDeductions
      .filter((d) => d.ficaExempt)
      .reduce((s, d) => s + d.amount, 0);
    const segFicaBase = segGross - ficaExempt;

    for (let p = seg.startPeriod; p <= seg.endPeriod; p++) {
      totalGross += segGross;
      totalFederalWithholding += segFederal;
      totalPreTax += segPreTax;
      totalPostTax += segPostTax;

      // FICA: track cumulative base for SS cap
      ytdFicaBase += segFicaBase;
      let periodSS: number;
      if (ytdFicaBase <= ssWageBase) {
        periodSS = segFicaBase * ssRate;
      } else if (ytdFicaBase - segFicaBase >= ssWageBase) {
        periodSS = 0;
      } else {
        const remainingBase = ssWageBase - (ytdFicaBase - segFicaBase);
        periodSS = remainingBase * ssRate;
      }
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

  // Weighted average salary
  const totalPeriods = segments.reduce(
    (s, seg) => s + (seg.endPeriod - seg.startPeriod + 1),
    0,
  );
  const blendedSalary =
    totalPeriods > 0
      ? segments.reduce(
          (s, seg) => s + seg.salary * (seg.endPeriod - seg.startPeriod + 1),
          0,
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
    actualYtdContributions: null,
    actualYtdEmployerMatch: null,
  };
}
