/**
 * Paycheck Calculator
 *
 * Computes per-period net pay by walking through the paycheck waterfall:
 *   Gross salary ÷ periods → Pre-tax deductions → Federal withholding → FICA → Post-tax deductions → Net pay
 *
 * Key concepts:
 *   - FICA base ≠ federal taxable base. Section 125 deductions (health insurance, marked ficaExempt)
 *     and payroll contributions to an account type flagged payrollFicaExempt (HSA, within its
 *     yearly cap) reduce BOTH FICA and income tax. 401k deferrals only reduce income tax, NOT FICA.
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
 *   - Bonus estimate uses the IRS supplemental flat rate (from input, not hardcoded) and deducts
 *     the contributions each account takes from bonus checks (`fromBonus`).
 */
import type {
  PaycheckInput,
  PaycheckResult,
  BlendedAnnualTotals,
  DeductionLine,
  PeriodBreakdown,
  BonusEstimate,
} from "./types";
import { formatCurrency, formatPercent } from "../utils/format";
import { roundToCents, safeDivide, sumBy } from "../utils/math";
import { MS_PER_DAY } from "../constants";
import { PAY_PERIOD_LABELS } from "../config/display-labels";
import { sumBracketTax } from "./tax-brackets";

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
  let marginalRate = 0;
  let bracketMin = 0;

  // First pass: find the highest bracket that applies (for marginal rate reporting).
  // Boundary-inclusive (>=), unlike sumBracketTax's own marginalRate — this
  // function needs the bracket the wage has REACHED (even if its taxable
  // slice is 0, exactly at the boundary) to compute bracketMin/baseWithholding
  // for the IRS withholding-table display; kept as its own pass deliberately.
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i]!;
    if (adjustedAnnualWage >= bracket.min) {
      marginalRate = bracket.rate;
      bracketMin = bracket.min;
      break;
    }
  }

  // Total tax: shared with tax.ts's annual-liability bracket walk
  const annualTax = sumBracketTax(adjustedAnnualWage, brackets).total;

  // Base withholding = total tax minus the marginal bracket's contribution
  // This matches the IRS withholding table format: "base + rate × (wage - bracket floor)"
  const baseWithholding =
    annualTax - (adjustedAnnualWage - bracketMin) * marginalRate;

  return { annualTax, marginalRate, bracketMin, baseWithholding };
}

/**
 * Walks `anchorPayDate` forward or backward by `intervalDays` until it lands
 * on the first payday on or after `referenceDate` (inclusive — the result
 * may equal `referenceDate` exactly). Used to align an arbitrary known
 * payday to the start of whichever year is being analyzed, before walking
 * paydays forward from there.
 *
 * NOT used by findNextPayDate, which needs the payday strictly after (not
 * on) its reference date — a different boundary, kept separate deliberately
 * rather than folded into this same helper.
 */
function alignPaydayOnOrAfter(
  anchorPayDate: Date,
  referenceDate: Date,
  intervalDays: number,
): Date {
  const msPerDay = MS_PER_DAY;
  let payday = new Date(anchorPayDate);
  while (payday > referenceDate) {
    payday = new Date(payday.getTime() - intervalDays * msPerDay);
  }
  while (payday < referenceDate) {
    payday = new Date(payday.getTime() + intervalDays * msPerDay);
  }
  return payday;
}

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

/** Per-period payroll contribution that isn't FICA wages: the contribution,
 *  up to its yearly FICA-exempt cap spread over the year. 0 when the
 *  account's payroll money is FICA wages (cap null) or not payroll-deducted. */
function regularFicaExemptPerPeriod(
  ca: PaycheckInput["contributionAccounts"][number],
  periodsPerYear: number,
): number {
  const cap = ca.ficaExemptAnnualCap;
  if (!ca.isPayrollDeducted || cap === null || cap === undefined) return 0;
  // Only pre-tax money skips FICA — an after-tax row (bad data, an old
  // backup) is FICA wages, the same read-time rule as deductions.
  if (!isPreTax(ca.taxTreatment)) return 0;
  return Math.min(ca.perPeriodContribution, cap / periodsPerYear);
}

/**
 * Federal and FICA withheld on the first `periods` regular checks of the
 * year, from the year schedule — which charges full Social Security until
 * the wage base is reached, unlike the per-check figure (the year's SS
 * spread over every check). Bonus withholding isn't included.
 */
export function withheldThroughPeriod(
  schedule: readonly PeriodBreakdown[],
  periods: number,
): { federal: number; fica: number } {
  const done = schedule.slice(0, Math.max(0, periods));
  return {
    federal: roundToCents(sumBy(done, (p) => p.federalWithholding)),
    fica: roundToCents(sumBy(done, (p) => p.ficaSS + p.ficaMedicare)),
  };
}

/** Pre-tax treatments: traditional 401k ('pre_tax') and HSA ('hsa') both reduce taxable income. */
export function isPreTax(treatment: string): boolean {
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
  // Other pay on each check: cash lines are paid (gross, net); non-cash
  // lines (imputed income) are only taxed. Each line says which taxes
  // apply, so a cash line exempt from a tax comes back out of that base.
  const earnings = input.earnings ?? [];
  const cashEarnings = sumBy(
    earnings.filter((e) => e.isCash),
    (e) => e.amount,
  );
  const sumTaxable = (tax: "federalTaxable" | "ficaTaxable") =>
    sumBy(
      earnings.filter((e) => !e.isCash && e[tax]),
      (e) => e.amount,
    ) -
    sumBy(
      earnings.filter((e) => e.isCash && !e[tax]),
      (e) => e.amount,
    );
  const federalEarningsAdjustment = sumTaxable("federalTaxable");
  const ficaEarningsAdjustment = sumTaxable("ficaTaxable");
  const gross = roundToCents(
    safeDivide(input.annualSalary, periodsPerYear, 0)! + cashEarnings,
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
  // A contribution is FICA-exempt only when its account type says payroll
  // money goes in under a §125 cafeteria plan (config payrollFicaExempt —
  // HSA), up to its yearly cap (ficaExemptAnnualCap, sized server-side
  // from the IRS limit less employer money). 401(k)/403(b) deferrals are
  // always FICA wages.
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

  const totalPreTax = sumBy(preTaxDeductions, (d) => d.amount);
  const totalPostTax = sumBy(postTaxDeductions, (d) => d.amount);

  // ── Step 2: Compute FICA base ──
  // FICA base = gross minus FICA-exempt money: Section 125 deductions
  // (health/dental/vision) and payroll contributions to an account type
  // that is FICA-exempt through payroll (HSA), within its yearly cap.
  // 401(k) deferrals reduce income tax but NOT FICA.
  // A deduction only counts as FICA-exempt when it is also pre-tax — a row
  // flagged exempt but after-tax (bad data, an old backup) is FICA wages.
  const ficaExemptFromDeductions = sumBy(
    input.deductions.filter((d) => d.ficaExempt && isPreTax(d.taxTreatment)),
    (d) => d.amount,
  );
  const ficaExemptFromContribs = sumBy(input.contributionAccounts, (ca) =>
    regularFicaExemptPerPeriod(ca, periodsPerYear),
  );
  const ficaBase =
    gross -
    ficaExemptFromDeductions -
    ficaExemptFromContribs +
    ficaEarningsAdjustment;

  // ── Step 3: Federal withholding (IRS annualized method) ──
  // Federal taxable gross = gross minus ALL pre-tax deductions (401k, HSA, health insurance, etc.)
  // plus taxable benefits not paid in cash (imputed income).
  const federalTaxableGross = gross - totalPreTax + federalEarningsAdjustment;

  // Annualize for bracket lookup, then divide result back to per-period.
  // Pub 15-T Worksheet 1A line 1h: subtract the line 1g adjustment —
  // previously missing, meaning a w4Checkbox=false employee was over-
  // withheld by w4Adjustment * marginalRate every year.
  const adjustedAnnualWage = Math.max(
    0,
    federalTaxableGross * periodsPerYear - input.taxBrackets.w4Adjustment,
  );
  const { annualTax, marginalRate } = lookupFederalWithholding(
    adjustedAnnualWage,
    input.taxBrackets.brackets,
  );
  // W-4 Line 4c: a flat extra dollar amount added directly to PER-CHECK
  // withholding, never folded into adjustedAnnualWage before the bracket
  // lookup (that would incorrectly annualize a per-check amount) and never
  // applied to marginalRate (which feeds the bonus supplemental-rate path
  // below — that's a flat rate, not the per-check W-4 mechanism).
  const federalWithholding =
    safeDivide(annualTax, periodsPerYear, 0)! + input.additionalFedWithholding;

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
    // The wage base is reached during the year: SS stops once it is. The
    // per-check figure is the year's SS spread evenly, so per-check net
    // × periods is the true annual take-home (checks before the cap pay
    // more, after it none — the year schedule shows the timing).
    // A caller that knows this check is already past the base (YTD) gets
    // this check's real figure instead.
    if (input.ytdGrossEarnings > 0 && input.ytdGrossEarnings >= ssWageBase) {
      ficaSS = 0;
      warnings.push("SS wage base exceeded for this period");
    } else {
      ficaSS = (ssWageBase * ssRate) / periodsPerYear;
      warnings.push(
        `Social Security stops once your pay for the year passes ${formatCurrency(ssWageBase)}; per-check figures average it over the year.`,
      );
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
  const bonusEstimate = calculateBonus(input, marginalRate, annualFicaBase);

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
    earnings,
    preTaxDeductions,
    federalTaxableGross,
    federalWithholding: roundToCents(federalWithholding),
    ficaWages: roundToCents(ficaBase),
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
 * FICA is applied to the bonus's FICA wages; SS only on the wage-base room the year's regular
 * FICA wages leave.
 *
 * The bonus check takes each contribution account's bonus-check amount
 * (bonusCheckContribution) — only accounts set to be taken from bonus checks.
 */
/**
 * Whether the bonus check takes this account: paid through payroll and set
 * to be taken from bonus checks (`fromBonus`). The one rule — the bonus-check
 * amount, the employer match's pay and every label use it.
 */
export function takesFromBonusCheck(account: {
  isPayrollDeducted: boolean;
  fromBonus: boolean | undefined;
}): boolean {
  return account.isPayrollDeducted && account.fromBonus === true;
}

/**
 * What a bonus check takes for one contribution account: a percent-of-pay
 * account its rate of the bonus, a fixed-amount account its regular
 * per-period dollars, an account not paid through payroll — or not set to be
 * taken from bonus checks (`fromBonus`, a Contribution Profile election) —
 * nothing. The one rule, and the one gate, for money contributed from bonus
 * checks: the paycheck, the contribution summary and the retirement
 * projection all use it.
 */
export function bonusCheckContribution(
  account: {
    isPayrollDeducted: boolean;
    /** Also taken from bonus checks. */
    fromBonus: boolean | undefined;
    rateOfGross: number | null;
    perPeriodContribution: number;
  },
  bonusGross: number,
): number {
  if (!takesFromBonusCheck(account) || bonusGross <= 0) return 0;
  return account.rateOfGross !== null
    ? roundToCents(account.rateOfGross * bonusGross)
    : account.perPeriodContribution;
}

function calculateBonus(
  input: PaycheckInput,
  _marginalRate: number,
  /** Regular pay's FICA wages for the year — what has used the SS wage base before the bonus. */
  regularFicaWagesAnnual: number,
): BonusEstimate {
  if (input.bonusPercent <= 0 && input.bonusOverride === null) {
    return {
      bonusGross: 0,
      bonusNet: 0,
      bonusFederalWithholding: 0,
      bonusFica: 0,
      bonusContributions: 0,
      bonusFicaWages: 0,
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

  // FICA on bonus. Its FICA wages are the bonus less any FICA-exempt
  // payroll contribution the bonus check takes (HSA, within the cap the
  // regular checks haven't used). SS only on the wage-base room the year's
  // regular FICA wages leave.
  const ssRate = input.taxBrackets.socialSecurityRate;
  const medRate = input.taxBrackets.medicareRate;
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const bonusFicaExempt = sumBy(input.contributionAccounts, (ca) => {
    const cap = ca.ficaExemptAnnualCap;
    if (cap === null || cap === undefined) return 0;
    if (!isPreTax(ca.taxTreatment)) return 0;
    const capLeft =
      cap - regularFicaExemptPerPeriod(ca, periodsPerYear) * periodsPerYear;
    return Math.min(
      bonusCheckContribution(ca, bonusGross),
      Math.max(0, capLeft),
    );
  });
  const bonusFicaWages = Math.max(0, bonusGross - bonusFicaExempt);
  const ssCapRoom = Math.max(
    0,
    ssWageBase - Math.min(regularFicaWagesAnnual, ssWageBase),
  );
  const bonusSsTaxable = Math.min(bonusFicaWages, ssCapRoom);
  const bonusFicaSS = roundToCents(bonusSsTaxable * ssRate);
  const bonusFicaMed = roundToCents(bonusFicaWages * medRate);
  const bonusFica = bonusFicaSS + bonusFicaMed;

  // What the bonus check takes for contributions (accounts set to be taken
  // from bonus checks). Percent-of-salary accounts scale against bonusGross;
  // fixed-amount accounts take their regular per-period dollars.
  const bonusContributions = sumBy(input.contributionAccounts, (ca) =>
    bonusCheckContribution(ca, bonusGross),
  );

  const bonusNet = roundToCents(
    bonusGross - bonusFederalWithholding - bonusFica - bonusContributions,
  );

  return {
    bonusGross,
    bonusNet,
    bonusFederalWithholding,
    bonusFica,
    bonusContributions,
    bonusFicaWages,
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
  const jan1 = new Date(Date.UTC(year, 0, 1));
  let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

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
 * Paychecks so far this year: walked from the job's anchor payday when it
 * has one, else estimated from the month. One rule for every view that
 * pro-rates a paycheck plan (Contributions' YTD / Year-End Estimate, the
 * Dashboard's Saved This Year).
 */
export function periodsElapsedYtd(
  asOfDate: Date,
  payPeriod: string,
  anchorPayDate: string | Date | null | undefined,
  periodsPerYear: number,
): number {
  return anchorPayDate
    ? countPeriodsElapsed(asOfDate, payPeriod, new Date(anchorPayDate))
    : Math.round((asOfDate.getMonth() / 12) * periodsPerYear);
}

/** Months of contributions so far this year for a monthly schedule (a month counts from the 15th). */
export function monthsElapsedYtd(asOfDate: Date): number {
  return asOfDate.getMonth() + (asOfDate.getDate() >= 15 ? 1 : 0);
}

/**
 * Months done this year for a monthly contribution, given the day its
 * latest contribution actually arrived (YYYY-MM-DD, if known): a month
 * whose contribution has posted is done even before the 15th, so the rest
 * of the year isn't counted from a month that's already in.
 */
export function monthsDoneYtd(
  asOfDate: Date,
  latestContributionDay: string | null | undefined,
): number {
  const byDate = monthsElapsedYtd(asOfDate);
  if (!latestContributionDay) return byDate;
  const [y, m] = latestContributionDay.split("-").map(Number);
  return y === asOfDate.getFullYear() ? Math.max(byDate, m!) : byDate;
}

/**
 * The share of a year's planned amount one contribution brings, by how it's
 * made: one paycheck, one month, or none for a once-a-year amount (it
 * isn't spread over the year).
 */
export function contribStepFraction(
  method: string,
  periodsPerYear: number,
): number {
  switch (method) {
    case "fixed_monthly":
      return 1 / 12;
    case "fixed_annual":
      return 0;
    default:
      return periodsPerYear > 0 ? 1 / periodsPerYear : 0;
  }
}

/**
 * The share of this year's planned amount still to come, by how the
 * contribution is made: per paycheck (percent of salary, fixed per period)
 * by paychecks left, monthly by months left, annual not at all.
 */
export function contribRemainingFraction(
  method: string,
  p: { periodsElapsed: number; periodsPerYear: number; monthsElapsed: number },
): number {
  switch (method) {
    case "fixed_monthly":
      return (12 - p.monthsElapsed) / 12;
    case "fixed_annual":
      return 0;
    default:
      return p.periodsPerYear > 0
        ? Math.max(0, p.periodsPerYear - p.periodsElapsed) / p.periodsPerYear
        : 1;
  }
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
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

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
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 7);

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
    const dec31 = new Date(Date.UTC(year, 11, 31));

    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, 14);

    const counts = new Array(12).fill(0) as number[];
    while (payday <= dec31) {
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
 * needs to import from a schema file — see RULES.md's pure-calculator rule.
 */
export function isExtraPaycheckBudgetMode(
  routing: { rules?: unknown[]; enabled?: boolean } | null | undefined,
): boolean {
  const rules = routing?.rules ?? [];
  return rules.length === 0 ? true : routing?.enabled === false;
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
    const jan1 = new Date(Date.UTC(year, 0, 1));
    let payday = alignPaydayOnOrAfter(anchorPayDate, jan1, interval);

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

    // FICA base for this period includes the bonus's FICA wages
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

    const periodMed = periodFicaBase * medRate;

    // Split FICA between regular and bonus portions for display
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
    // Walk backward past asOfDate, then forward to find first date > asOfDate.
    // Deliberately NOT alignPaydayOnOrAfter — that helper's boundary is
    // inclusive (payday may equal referenceDate); this needs the payday
    // strictly after asOfDate, so it keeps its own loop.
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
  const base = PAY_PERIOD_LABELS[payPeriod] ?? payPeriod;
  if (payPeriod === "semimonthly") {
    return `${base} (1st & 15th)`;
  }
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

  // Weighted average salary
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
    actualYtdContributions: null,
    actualYtdEmployerMatch: null,
  };
}
