/**
 * Pure budget-page helpers that reshape paycheck data into payroll/non-payroll
 * breakdowns. Local casts stand in for `@/server/*` types (no-restricted-imports).
 */

import { computeAnnualContribution } from "@/lib/pure/contributions/contribution-amount";
import { computeValue } from "@/lib/pure/contributions/contribution-caps";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import type { PayrollBreakdown, SinkingFundLine } from "./types";
import type { ContributionMethod } from "@/lib/config/enum-values";

export function buildPayrollBreakdown(
  paycheckData: unknown,
): PayrollBreakdown | null {
  if (!paycheckData || !Array.isArray(paycheckData)) return null;
  const data = paycheckData as Array<{
    paycheck: {
      periodsPerYear: number;
      gross: number;
      federalWithholding: number;
      ficaSS: number;
      ficaMedicare: number;
      preTaxDeductions: { name: string; amount: number }[];
      postTaxDeductions: { name: string; amount: number }[];
    } | null;
    job: unknown;
    person: { name: string };
    budgetPerMonth?: number;
    budgetNote?: string;
  }>;
  const activePeople = data.filter((d) => d.paycheck && d.job);
  if (activePeople.length === 0) return null;

  let grossMonthly = 0;
  let federalWithholding = 0;
  let ficaSS = 0;
  let ficaMedicare = 0;
  const preTaxLines: { name: string; monthly: number }[] = [];
  const postTaxLines: { name: string; monthly: number }[] = [];
  const takeHomeLines: { name: string; monthly: number }[] = [];
  const grossLines: { name: string; monthly: number }[] = [];

  // Collect budget notes from all people for dynamic help text
  const budgetNotes: string[] = [];

  for (const d of activePeople) {
    const pc = d.paycheck!;
    // Use server-provided budget periods per month (respects per-job override)
    const perMonth = d.budgetPerMonth ?? pc.periodsPerYear / 12;
    const toMonthly = (perPeriod: number) => perPeriod * perMonth;
    if (d.budgetNote) budgetNotes.push(d.budgetNote);

    grossMonthly += toMonthly(pc.gross);
    if (activePeople.length > 1) {
      grossLines.push({ name: d.person.name, monthly: toMonthly(pc.gross) });
    }
    federalWithholding += toMonthly(pc.federalWithholding);
    ficaSS += toMonthly(pc.ficaSS);
    ficaMedicare += toMonthly(pc.ficaMedicare);

    for (const ded of pc.preTaxDeductions) {
      const label =
        activePeople.length > 1 ? `${ded.name} (${d.person.name})` : ded.name;
      preTaxLines.push({ name: label, monthly: toMonthly(ded.amount) });
    }
    for (const ded of pc.postTaxDeductions) {
      const label =
        activePeople.length > 1 ? `${ded.name} (${d.person.name})` : ded.name;
      postTaxLines.push({ name: label, monthly: toMonthly(ded.amount) });
    }

    if (activePeople.length > 1) {
      const personTaxes = toMonthly(
        pc.federalWithholding + pc.ficaSS + pc.ficaMedicare,
      );
      const personPreTax = pc.preTaxDeductions.reduce(
        (s, ded) => s + toMonthly(ded.amount),
        0,
      );
      const personPostTax = pc.postTaxDeductions.reduce(
        (s, ded) => s + toMonthly(ded.amount),
        0,
      );
      takeHomeLines.push({
        name: d.person.name,
        monthly:
          toMonthly(pc.gross) - personTaxes - personPreTax - personPostTax,
      });
    }
  }

  const totalPreTax = preTaxLines.reduce((s, d) => s + d.monthly, 0);
  const totalPostTax = postTaxLines.reduce((s, d) => s + d.monthly, 0);
  const totalTaxes = federalWithholding + ficaSS + ficaMedicare;
  const netMonthly = grossMonthly - totalTaxes - totalPreTax - totalPostTax;

  // Build dynamic budget note from all people's notes
  const budgetNote =
    budgetNotes.length > 0 ? budgetNotes.join("; ") : "Regular monthly pay";

  return {
    grossMonthly,
    federalWithholding,
    ficaSS,
    ficaMedicare,
    totalTaxes,
    preTaxLines,
    totalPreTax,
    postTaxLines,
    totalPostTax,
    netMonthly,
    takeHomeLines,
    grossLines,
    budgetNote,
  };
}

export function buildNonPayrollContributions(
  paycheckData: unknown,
  // Accounts already linked to a budget item, excluded so their dollars aren't
  // also name-matched onto another item.
  linkedAccountIds: Set<number> = new Set(),
): Map<string, number> {
  if (!paycheckData || !Array.isArray(paycheckData)) return new Map();
  const data = paycheckData as Array<{
    paycheck: { periodsPerYear: number } | null;
    job: unknown;
    salary?: number;
    rawContribs?: Array<{
      id: number;
      jobId: number | null;
      isPayrollDeducted: boolean | null;
      contributionValue: string | number;
      cappedValue?: number;
      contributionMethod: ContributionMethod;
      accountType: string;
    }>;
  }>;
  const map = new Map<string, number>();
  for (const d of data) {
    if (!d.paycheck || !d.job) continue;
    for (const c of d.rawContribs ?? []) {
      // Payroll vs take-home uses isPaidThroughPayroll (isPayrollDeducted, else
      // jobId). A job-tied account funded from take-home stays in this pool.
      if (isPaidThroughPayroll(c)) continue;
      if (linkedAccountIds.has(c.id)) continue;
      const val = computeValue(c) || 0;
      const monthly = monthlyContribution(
        c.contributionMethod,
        val,
        d.salary ?? 0,
        d.paycheck.periodsPerYear,
      );
      const existing = map.get(c.accountType) ?? 0;
      map.set(c.accountType, existing + monthly);
    }
  }
  return map;
}

/** A row's monthly dollars: a monthly amount as entered, else its yearly
 *  dollars ÷ 12. */
function monthlyContribution(
  method: ContributionMethod,
  value: number,
  salary: number,
  periodsPerYear: number,
): number {
  if (method === "fixed_monthly") return value;
  return computeAnnualContribution(method, value, salary, periodsPerYear) / 12;
}

/**
 * A joint contribution's monthly figure. Joint money has no pay of its own:
 * a percent is $0, and a per-check amount follows the first paycheck's schedule (`periodsPerYear`,
 * undefined when nobody has one).
 */
export function jointContributionMonthly(
  method: ContributionMethod,
  value: number,
  periodsPerYear: number | undefined,
): number {
  if (method === "fixed_per_period" && !periodsPerYear) return value / 12;
  return monthlyContribution(method, value, 0, periodsPerYear ?? 0);
}

/** Sum of all sinking-fund monthly commitments. */
export function computeTotalSinking(
  sinkingFunds: SinkingFundLine[] | null | undefined,
): number {
  return sinkingFunds?.reduce((s, f) => s + f.monthlyContribution, 0) ?? 0;
}

/**
 * Take-home minus budgeted expenses minus sinking funds: the unassigned monthly
 * leftover. Shared by the Savings row and the summary bar headline.
 */
export function computeUnallocated(
  netMonthly: number,
  totalMonthly: number,
  totalSinking: number,
): number {
  return netMonthly - totalMonthly - totalSinking;
}
