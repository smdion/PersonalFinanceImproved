/**
 * Pure helper functions shared by the budget page.
 *
 * These reshape the per-column paycheck data returned by
 * `usePerColumnPaycheck` into the payroll + non-payroll breakdowns the
 * budget summary table and contribution matching rely on. The hand-rolled
 * local casts are intentional: narrowing against `@/server/*` types would
 * violate the `no-restricted-imports` rule at eslint.config.mjs lines
 * 44-64.
 */

import type { PayrollBreakdown, SinkingFundLine } from "./types";

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

export function buildNonPayrollContribs(
  paycheckData: unknown,
  // Contribution accounts already linked to a budget item (via
  // RawItem.contributionAccountId) — excluded here so a linked account's
  // real dollars can't ALSO get name-matched onto some other unlinked
  // budget item and double-count. See portfolio label fix upstream for
  // the sibling case of the same "one account, two identities" pattern.
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
      contributionMethod: string;
      accountType: string;
    }>;
  }>;
  const map = new Map<string, number>();
  for (const d of data) {
    if (!d.paycheck || !d.job) continue;
    for (const c of d.rawContribs ?? []) {
      // The canonical payroll-vs-net-level signal is isPayrollDeducted,
      // falling back to jobId presence only when unset (same resolution
      // used in src/lib/calculators/paycheck.ts and
      // src/server/helpers/contribution.ts) — jobId alone just means "tied
      // to this employer," not "deducted from that employer's paycheck." A
      // job-tied account the user explicitly funds from take-home (box
      // unchecked) must still land in this non-payroll pool.
      if (c.isPayrollDeducted ?? c.jobId !== null) continue;
      if (linkedAccountIds.has(c.id)) continue;
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

/** Sum of all sinking-fund monthly commitments. */
export function computeTotalSinking(
  sinkingFunds: SinkingFundLine[] | null | undefined,
): number {
  return sinkingFunds?.reduce((s, f) => s + f.monthlyContribution, 0) ?? 0;
}

/**
 * Take-home pay minus budgeted expenses minus sinking-fund commitments —
 * what's left over each month with nowhere assigned. Shared by the Savings
 * row breakdown and the summary bar's headline figure so they can't drift.
 */
export function computeUnallocated(
  netMonthly: number,
  totalMonthly: number,
  totalSinking: number,
): number {
  return netMonthly - totalMonthly - totalSinking;
}
