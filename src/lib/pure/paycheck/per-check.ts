/**
 * Per-period net pay: gross (salary ÷ its divisor) → pre-tax deductions → federal withholding (IRS annualized
 * method) → FICA → post-tax deductions. Only payroll-deducted contribution accounts are deductions;
 * Section 125 and payroll-FICA-exempt money (HSA) leave the FICA base, 401k deferrals don't.
 */
import type {
  PaycheckInput,
  PaycheckResult,
  DeductionLine,
} from "./paycheck.types";
import { formatCurrency } from "../../utils/format";
import { inputWarnings } from "./input-warnings";
import { roundToCents, safeDivide, sumBy } from "../../utils/math";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { sumBracketTax } from "../tax/tax-brackets";
import { isPreTax, regularFicaExemptPerPeriod } from "./taxable-wages";
import { calculateBonus } from "./bonus";
import { additionalMedicareWithheld } from "./additional-medicare";
import { bonusOnSchedule } from "./bonus-check";
import { findExtraPaycheckMonths } from "./extra-paycheck-months";
import { buildYearSchedule } from "./year-schedule";
import { jobChecksThisYear } from "./job-last-check";
import { salaryDivisor, yearPaydays } from "./year-paydays";
import {
  buildPayFrequencyLabel,
  countPeriodsElapsed,
  findNextPayDate,
} from "./pay-periods-in-year";

/**
 * IRS annualized bracket lookup: total annual tax, marginal rate (highest bracket touched), its
 * floor and the base withholding below it (worksheet display). Brackets tax [min, max), null = top.
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

  // Highest bracket reached (>=, even with a 0 slice at the boundary), unlike sumBracketTax's
  // marginalRate: bracketMin/baseWithholding for the withholding-table display need it.
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
  const { warnings } = inputWarnings(input);

  // Periods annualize withholding (Pub 15-T); paydays count the year's checks; the divisor sizes each.
  const periodsPerYear = getPeriodsPerYear(input.payPeriod);
  const paydays = yearPaydays(input);
  const divisor = salaryDivisor(input);
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
    safeDivide(input.annualSalary, divisor, 0)! + cashEarnings,
  );

  // ── Step 1: Classify deductions ──
  // Pre-tax and post-tax lines: input.deductions and payroll-deducted contribution accounts.
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

  // Source 2: payroll-deducted contribution accounts (IRA, brokerage are outside the paycheck).
  // FICA-exempt only for a payrollFicaExempt account type (§125, HSA), up to ficaExemptAnnualCap
  // (IRS limit less employer money); 401(k)/403(b) deferrals are always FICA wages.
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
  // Gross minus Section 125 deductions (FICA-exempt, always pre-tax) and payroll-FICA-exempt
  // contributions (HSA, within its cap). 401(k) deferrals stay FICA wages.
  const ficaExemptFromDeductions = sumBy(
    input.deductions.filter((d) => d.ficaExempt),
    (d) => d.amount,
  );
  const ficaExemptFromContributions = sumBy(input.contributionAccounts, (ca) =>
    regularFicaExemptPerPeriod(ca, paydays),
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

  // Annualize for the bracket lookup, then divide back to per-period.
  // Pub 15-T Worksheet 1A line 1h: subtract the line 1g adjustment.
  const adjustedAnnualWage = Math.max(
    0,
    federalTaxableGross * periodsPerYear - input.taxBrackets.w4Adjustment,
  );
  const { annualTax, marginalRate } = lookupFederalWithholding(
    adjustedAnnualWage,
    input.taxBrackets.brackets,
  );
  // W-4 Line 4c: a flat per-check extra, added after the bracket lookup (never annualized) and
  // kept out of marginalRate, which feeds the bonus supplemental-rate path.
  const federalWithholding =
    safeDivide(annualTax, periodsPerYear, 0)! + input.additionalFedWithholding;

  // ── Step 4: FICA taxes ──
  // Social Security on the FICA base up to the wage base; one W-2 employer is modeled.
  const ssWageBase = input.taxBrackets.socialSecurityWageBase;
  const ssRate = input.taxBrackets.socialSecurityRate;
  const annualFicaBase = ficaBase * paydays;
  let ficaSS: number;
  if (annualFicaBase <= ssWageBase) {
    // Full-year SS applies — every period pays SS
    ficaSS = ficaBase * ssRate;
  } else {
    // Wage base reached during the year: per-check SS is the year's SS spread evenly, so
    // per-check net × periods is true take-home (the year schedule shows timing).
    ficaSS = (ssWageBase * ssRate) / paydays;
    warnings.push(
      `Social Security stops once your pay for the year passes ${formatCurrency(ssWageBase)}; per-check figures average it over the year.`,
    );
  }

  // Medicare on the FICA base, no cap. Additional Medicare past the threshold is averaged
  // over the year's checks, like Social Security; the year schedule shows the real checks.
  const additionalMedicarePerCheck =
    additionalMedicareWithheld(
      input.taxBrackets,
      annualFicaBase,
      annualFicaBase,
    ) / paydays;
  const ficaMedicare =
    ficaBase * input.taxBrackets.medicareRate + additionalMedicarePerCheck;

  // ── Step 5: Net pay ──
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
  // Biweekly months with 3 paydays, found from anchorPayDate (a real payday: no payWeek shift).
  const extraPaycheckMonths = findExtraPaycheckMonths(
    input.asOfDate,
    input.payPeriod,
    input.anchorPayDate,
  );

  // ── Step 8: Year schedule ──
  // Every pay period, with the bonus in its month and SS stopping at the wage base. Paydays
  // before a job's start or after its end this year stay (numbering) but pay nothing.
  const checks = jobChecksThisYear(input);
  const yearSchedule = buildYearSchedule(
    input,
    gross,
    totalPreTax,
    federalWithholding,
    ficaBase,
    totalPostTax,
    bonusEstimate,
    checks,
  );

  // Paydays so far this year by the calendar — the year schedule's index
  // (checks this job paid = this − checks.beforeStart).
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
    extraPaycheckMonths,
    yearSchedule,
    periodsPerYear: paydays,
    periodsElapsedYtd,
    periodsBeforeStart: checks.beforeStart,
    // Where the bonus falls against the job's checks (for display).
    ...bonusOnSchedule(input, bonusEstimate.bonusGross, checks.beforeStart),
    nextPayDate,
    payFrequencyLabel,
    warnings,
  };
}
