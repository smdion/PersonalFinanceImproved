/**
 * Contribution Calculator
 *
 * Summarizes all investment/savings contribution accounts and computes savings rates by group.
 *
 * Key design: grouping is DATA-DRIVEN, not hardcoded. Each account has a `group` field
 * (e.g. "retirement", "portfolio", "education") set by the user in account settings. The
 * calculator dynamically aggregates by whatever groups exist. This means:
 *   - Adding a new group (like "education") requires zero code changes
 *   - The UI renders whatever groups come back in `groupRates`
 *   - Group rates include employer match (e.g. 401k match counts toward retirement rate)
 *
 * Example groups:
 *   - "retirement" = 401k + IRA + employer matches → retirement savings rate (e.g. 21.89%)
 *   - "portfolio"  = retirement + HSA + brokerage   → total portfolio savings rate (e.g. 29.59%)
 *
 * Each rate = (employee contributions + employer matches for that group) ÷ annual salary.
 */
import type { ContributionInput, ContributionResult } from "./types";
import { roundToCents, safeDivide, sumBy } from "../utils/math";

export function calculateContributions(
  input: ContributionInput,
): ContributionResult {
  const warnings: string[] = [];
  const { annualSalary, contributionAccounts } = input;
  // Savings rate denominator: total comp (includes bonus) — falls back to annualSalary
  const rateDenominator = input.totalCompensation ?? annualSalary;

  // Map each account to its summary: annual contribution, employer match, and % of salary
  const accounts = contributionAccounts.map((ca) => ({
    name: ca.name,
    group: ca.group,
    annualContribution: roundToCents(ca.annualContribution),
    employerMatch: roundToCents(ca.employerMatch),
    percentOfSalary: Number(
      safeDivide(ca.annualContribution, annualSalary) ?? 0,
    ),
  }));

  // Total includes both employee and employer contributions across all accounts
  const totalAnnualContributions = roundToCents(
    sumBy(accounts, (a) => a.annualContribution + a.employerMatch),
  );

  // Dynamically aggregate by group — no hardcoded group names
  // Two views: with match (full picture) and without match (employee-only effort)
  const groupMap = new Map<string, number>();
  const groupMapExMatch = new Map<string, number>();
  for (const a of accounts) {
    groupMap.set(
      a.group,
      (groupMap.get(a.group) ?? 0) + a.annualContribution + a.employerMatch,
    );
    groupMapExMatch.set(
      a.group,
      (groupMapExMatch.get(a.group) ?? 0) + a.annualContribution,
    );
  }

  // Convert group totals to rates (as fraction of total compensation)
  const groupRates: Record<string, number> = {};
  const groupRatesExMatch: Record<string, number> = {};
  groupMap.forEach((total, group) => {
    groupRates[group] = Number(safeDivide(total, rateDenominator) ?? 0);
  });
  groupMapExMatch.forEach((total, group) => {
    groupRatesExMatch[group] = Number(safeDivide(total, rateDenominator) ?? 0);
  });

  // "total" is the combined savings rate across ALL groups
  const allTotal = Array.from(groupMap.values()).reduce((s, v) => s + v, 0);
  const allTotalExMatch = Array.from(groupMapExMatch.values()).reduce(
    (s, v) => s + v,
    0,
  );
  groupRates["total"] = Number(safeDivide(allTotal, rateDenominator) ?? 0);
  groupRatesExMatch["total"] = Number(
    safeDivide(allTotalExMatch, rateDenominator) ?? 0,
  );

  const totalEmployeeOnly = roundToCents(
    sumBy(accounts, (a) => a.annualContribution),
  );

  return {
    groupRates,
    groupRatesExMatch,
    totalAnnualContributions,
    totalEmployeeOnly,
    accounts,
    warnings,
  };
}
