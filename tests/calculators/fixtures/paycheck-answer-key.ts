/**
 * Inputs for the paycheck answer-key suites
 * (`answer-key-paycheck*.test.ts`): the shipped withholding tables and FICA
 * figures shaped as `calculatePaycheck` takes them, and a plain invented
 * job. Nothing here is an expected figure: the tests work those by hand.
 */
import { taxDataLimitMap, taxDataWithholding } from "../../helpers/tax-data";
import { toTaxableIncomeBrackets } from "@/lib/calculators/tax-brackets";
import type {
  ContributionAccountInput,
  DeductionLine,
  PaycheckInput,
  PayPeriodType,
  TaxBracketInput,
} from "@/lib/calculators/types";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export type Year = 2025 | 2026;

// ── The shipped tables, as the paycheck reads them ──────────────────────

const limits = taxDataLimitMap();

export function limit(year: Year, key: string): number {
  const v = limits.get(`${year}:${key}`);
  if (v === undefined) throw new Error(`no ${year} ${key}`);
  return v;
}

/**
 * Pub 15-T Worksheet 1A line 1g, as printed (T25 and T26 line 1g): the
 * same both years. An input from the publication, not from `src/`.
 */
function line1g(status: ReturnFilingStatus, checkbox: boolean): number {
  if (checkbox) return 0;
  return status === "MFJ" ? 12_900 : 8_600;
}

/** The year's withholding table (standard or Step 2(c)) and FICA figures,
 *  shaped as `calculatePaycheck` takes them. */
export function withholdingInput(
  year: Year,
  status: ReturnFilingStatus,
  checkbox = false,
): TaxBracketInput {
  const row = taxDataWithholding().find(
    (r) =>
      r.taxYear === year &&
      r.filingStatus === status &&
      r.w4Checkbox === checkbox,
  );
  if (!row) throw new Error(`no ${year} ${status} withholding table`);
  return {
    filingStatus: status,
    w4Checkbox: checkbox,
    brackets: row.brackets.map((b, i, all) => ({
      min: b.threshold,
      max: all[i + 1]?.threshold ?? null,
      rate: b.rate,
    })),
    standardDeduction: limit(
      year,
      `standard_deduction_${status.toLowerCase()}`,
    ),
    w4Adjustment: line1g(status, checkbox),
    socialSecurityWageBase: limit(year, "ss_wage_base"),
    socialSecurityRate: limit(year, "fica_ss_rate"),
    medicareRate: limit(year, "fica_medicare_rate"),
    medicareAdditionalRate: limit(year, "fica_medicare_surtax_rate"),
    medicareAdditionalThreshold: limit(year, "fica_medicare_surtax_threshold"),
  };
}

/** The Form 1040 rate schedule (the standard table shifted down by its
 *  first taxed threshold, spec BR-6) for the year's liability. */
export function liabilityInput(status: ReturnFilingStatus): TaxBracketInput {
  const w = withholdingInput(2026, status);
  return {
    ...w,
    brackets: toTaxableIncomeBrackets(w.brackets),
    w4Adjustment: 0,
  };
}

/** A 2026 job paying from Friday January 2 (26 biweekly paydays, the last
 *  December 18), Single, no deductions, no bonus. */
export function job(c: {
  salary: number;
  period: PayPeriodType;
  status?: ReturnFilingStatus;
  checkbox?: boolean;
  year?: Year;
  accounts?: ContributionAccountInput[];
  deductions?: DeductionLine[];
  bonus?: number;
  bonusPercent?: number;
  bonusMonth?: number;
  bonusDay?: number;
}): PaycheckInput {
  const year = c.year ?? 2026;
  return {
    annualSalary: c.salary,
    payPeriod: c.period,
    payWeek: "na",
    anchorPayDate: new Date(year === 2026 ? "2026-01-02" : "2025-01-03"),
    supplementalTaxRate: limit(year, "supplemental_tax_rate"),
    additionalFedWithholding: 0,
    contributionAccounts: c.accounts ?? [],
    deductions: c.deductions ?? [],
    earnings: [],
    taxBrackets: withholdingInput(year, c.status ?? "Single", c.checkbox),
    limits: {},
    ytdGrossEarnings: 0,
    bonusPercent: c.bonusPercent ?? 0,
    bonusMultiplier: 1,
    bonusOverride: c.bonus ?? null,
    monthsInBonusYear: 12,
    bonusMonth: c.bonusMonth ?? null,
    bonusDayOfMonth: c.bonusDay ?? null,
    asOfDate: new Date(`${year}-06-15T12:00:00Z`),
  };
}

/** A payroll contribution account. */
export function account(c: {
  name: string;
  perCheck: number;
  checks: number;
  treatment: ContributionAccountInput["taxTreatment"];
  rateOfGross?: number;
  fromBonus?: boolean;
  ficaExemptAnnualCap?: number | null;
  employerMatch?: number;
  /** The year's amount when it isn't per check × checks (a percent of
   *  salary: rate × salary). */
  annual?: number;
}): ContributionAccountInput {
  return {
    name: c.name,
    annualContribution:
      c.annual ?? Math.round(c.perCheck * c.checks * 100) / 100,
    perPeriodContribution: c.perCheck,
    rateOfGross: c.rateOfGross ?? null,
    taxTreatment: c.treatment,
    isPayrollDeducted: true,
    fromBonus: c.fromBonus ?? false,
    group: "retirement",
    employerMatch: c.employerMatch ?? 0,
    employerMatchTaxTreatment: "pre_tax",
    ficaExemptAnnualCap: c.ficaExemptAnnualCap ?? null,
  };
}

/** A paycheck deduction line (pre-tax ones are § 125, FICA-exempt). */
export function deduction(
  name: string,
  amount: number,
  taxTreatment: DeductionLine["taxTreatment"],
): DeductionLine {
  return { name, amount, taxTreatment, ficaExempt: taxTreatment === "pre_tax" };
}
