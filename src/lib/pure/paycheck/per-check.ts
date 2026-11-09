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
 *   - Social Security tax has a wage base cap ($184,500 in 2026). Once YTD FICA base exceeds the cap,
 *     SS withholding drops to $0 for remaining periods. The year schedule models this transition.
 *   - Contribution accounts (401k, IRA, HSA, brokerage) are only included as paycheck deductions
 *     when `isPayrollDeducted` is true. IRA and brokerage contributions flow outside the paycheck.
 */
import type {
  PaycheckInput,
  PaycheckResult,
  DeductionLine,
} from "./paycheck.types";
import { formatCurrency, formatPercent } from "../../utils/format";
import { roundToCents, safeDivide, sumBy } from "../../utils/math";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { sumBracketTax } from "../tax/tax-brackets";
import { isPreTax, regularFicaExemptPerPeriod } from "./taxable-wages";
import { calculateBonus, findBonusPeriod } from "./bonus";
import { findExtraPaycheckMonths } from "./extra-paycheck-months";
import { buildYearSchedule } from "./year-schedule";
import {
  buildPayFrequencyLabel,
  countPeriodsElapsed,
  findNextPayDate,
  periodsBeforeStart,
} from "./pay-periods-in-year";

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
  const earnings = input.earnings;
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
  const ficaExemptFromContributions = sumBy(input.contributionAccounts, (ca) =>
    regularFicaExemptPerPeriod(ca, periodsPerYear),
  );
  const ficaBase =
    gross -
    ficaExemptFromDeductions -
    ficaExemptFromContributions +
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
  // Social Security: 6.2% (from input) on FICA base, capped at wage base ($184,500 in 2026).
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
  // Additional Medicare is withheld on wages past the threshold, so the checks
  // late in the year carry it. Per-check figures average it over the year,
  // like Social Security above; the year schedule shows the real checks.
  const additionalMedicarePerCheck =
    (input.taxBrackets.medicareAdditionalRate *
      Math.max(
        0,
        annualFicaBase - input.taxBrackets.medicareAdditionalThreshold,
      )) /
    periodsPerYear;
  const ficaMedicare =
    ficaBase * input.taxBrackets.medicareRate + additionalMedicarePerCheck;

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
  // A job started this year pays nothing before its start: those paydays
  // stay in the schedule (calendar numbering) but empty, so this
  // employer's Social Security wage base counts from its first check.
  const beforeStart = periodsBeforeStart(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
    input.startDate,
  );
  const yearSchedule = buildYearSchedule(
    input,
    gross,
    totalPreTax,
    federalWithholding,
    ficaBase,
    totalPostTax,
    bonusEstimate,
    beforeStart,
  );

  // Paydays so far this year by the calendar — the year schedule's index
  // (checks this job paid = this − beforeStart).
  const periodsElapsedYtd = countPeriodsElapsed(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
  );

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
  // A bonus dated before the job started isn't this job's (the schedule
  // leaves it out too).
  const bonusPeriodFound =
    input.bonusMonth != null && bonusEstimate.bonusGross > 0
      ? findBonusPeriod(
          input.asOfDate,
          input.payPeriod,
          input.anchorPayDate,
          input.bonusMonth,
          input.bonusDayOfMonth,
        )
      : null;
  const bonusPeriod =
    bonusPeriodFound !== null && bonusPeriodFound > beforeStart
      ? bonusPeriodFound
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
    periodsBeforeStart: beforeStart,
    bonusBeforeStart:
      bonusPeriodFound !== null && bonusPeriodFound <= beforeStart,
    bonusUndated: input.bonusMonth == null && bonusEstimate.bonusGross > 0,
    nextPayDate,
    payFrequencyLabel,
    warnings,
  };
}
