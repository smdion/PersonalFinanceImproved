/**
 * Pure helper functions shared by the budget page. Extracted from
 * `src/app/(dashboard)/budget/page.tsx` during the v0.5.2 file-split
 * refactor — no behavior changes.
 *
 * These reshape the per-column paycheck data returned by
 * `usePerColumnPaycheck` into the payroll + non-payroll breakdowns the
 * budget summary table and contribution matching rely on. The hand-rolled
 * local casts are intentional: narrowing against `@/server/*` types would
 * violate the `no-restricted-imports` rule at eslint.config.mjs lines
 * 44-64.
 */

import type { PayrollBreakdown } from "./types";

export function buildPayrollBreakdown(
  paycheckData: unknown,
): PayrollBreakdown | null {
  if (!paycheckData) return null;
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

export function buildNonPayrollContribs(
  paycheckData: unknown,
): Map<string, number> {
  if (!paycheckData) return new Map();
  const data = paycheckData as Array<{
    paycheck: { periodsPerYear: number } | null;
    job: unknown;
    salary?: number;
    rawContribs?: Array<{
      jobId: number | null;
      contributionValue: string | number;
      contributionMethod: string;
      accountType: string;
    }>;
  }>;
  const map = new Map<string, number>();
  for (const d of data) {
    if (!d.paycheck || !d.job) continue;
    for (const c of d.rawContribs ?? []) {
      if (c.jobId !== null) continue;
      const val = Number(c.contributionValue) || 0;
      const periodsPerYear = d.paycheck.periodsPerYear;
      let monthly: number;
      if (c.contributionMethod === "percent_of_salary") {
        monthly = ((val / 100) * (d.salary ?? 0)) / 12;
      } else if (c.contributionMethod === "fixed_monthly") {
        monthly = val;
      } else {
        monthly = (val * periodsPerYear) / 12;
      }
      const existing = map.get(c.accountType) ?? 0;
      map.set(c.accountType, existing + monthly);
    }
  }
  return map;
}
