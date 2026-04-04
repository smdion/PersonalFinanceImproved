/**
 * Pure business logic extracted from the performance router's finalizeYear transaction.
 * These functions compute values without any DB or I/O dependency.
 */
import { toNumber } from "@/server/helpers/transforms";

/**
 * Modified Dietz return: gainLoss / (beginBal + netFlows/2).
 * Returns null when denominator is zero (no capital at risk).
 */
export function computeReturn(
  beginBal: number,
  contribs: number,
  gainLoss: number,
  employer: number,
  distributions: number,
  fees: number = 0,
  rollovers: number = 0,
): number | null {
  const denominator =
    beginBal + (contribs + rollovers + employer - distributions - fees) / 2;
  if (denominator === 0) return null;
  return gainLoss / denominator;
}

export type AccountLike = {
  beginningBalance: string | null;
  totalContributions: string | null;
  yearlyGainLoss: string | null;
  endingBalance: string | null;
  employerContributions: string | null;
  distributions: string | null;
  fees: string | null;
  rollovers: string | null;
};

/** Sum a set of account rows into a rollup. */
export function sumAccounts(accts: AccountLike[]) {
  let beginBal = 0,
    contribs = 0,
    gainLoss = 0,
    endBal = 0,
    employer = 0,
    distributions = 0,
    fees = 0,
    rollovers = 0;
  for (const a of accts) {
    beginBal += toNumber(a.beginningBalance);
    contribs += toNumber(a.totalContributions);
    gainLoss += toNumber(a.yearlyGainLoss);
    endBal += toNumber(a.endingBalance);
    employer += toNumber(a.employerContributions);
    distributions += toNumber(a.distributions);
    fees += toNumber(a.fees);
    rollovers += toNumber(a.rollovers);
  }
  return {
    beginBal,
    contribs,
    gainLoss,
    endBal,
    employer,
    distributions,
    fees,
    rollovers,
  };
}

export type AnnualRowLike = {
  beginningBalance: number;
  totalContributions: number;
  yearlyGainLoss: number;
  endingBalance: number;
  employerContributions: number;
  distributions: number;
  fees: number;
  rollovers: number;
  lifetimeGains: number;
  lifetimeContributions: number;
  lifetimeMatch: number;
};

/** Sum a set of annual rows (numeric) into a Portfolio rollup. */
export function sumAnnualRows(rows: AnnualRowLike[]) {
  let beginBal = 0,
    contribs = 0,
    gainLoss = 0,
    endBal = 0,
    employer = 0,
    distributions = 0,
    fees = 0,
    rollovers = 0,
    lifetimeGains = 0,
    lifetimeContribs = 0,
    lifetimeMatch = 0;
  for (const r of rows) {
    beginBal += r.beginningBalance;
    contribs += r.totalContributions;
    gainLoss += r.yearlyGainLoss;
    endBal += r.endingBalance;
    employer += r.employerContributions;
    distributions += r.distributions;
    fees += r.fees;
    rollovers += r.rollovers;
    lifetimeGains += r.lifetimeGains;
    lifetimeContribs += r.lifetimeContributions;
    lifetimeMatch += r.lifetimeMatch;
  }
  return {
    beginBal,
    contribs,
    gainLoss,
    endBal,
    employer,
    distributions,
    fees,
    rollovers,
    lifetimeGains,
    lifetimeContribs,
    lifetimeMatch,
  };
}

/** Shape of a category override provided by the user during finalization. */
export type CategoryOverride = {
  category: string;
  beginningBalance: string;
  totalContributions: string;
  yearlyGainLoss: string;
  endingBalance: string;
  employerContributions: string;
  distributions: string;
  fees: string;
  rollovers: string;
  lifetimeGains: string;
  lifetimeContributions: string;
  lifetimeMatch: string;
};

/** Previous year's lifetime baseline for carry-forward. */
export type LifetimeBaseline = {
  lifetimeGains: number;
  lifetimeContributions: number;
  lifetimeMatch: number;
};

/**
 * Resolve finalized values for a single category — either from user override or computed from accounts.
 * Returns the AnnualRowLike values to persist plus the computed return percentage.
 */
export function resolveCategoryValues(
  catAccounts: AccountLike[],
  override: CategoryOverride | undefined,
  prevLifetime: LifetimeBaseline,
): { values: AnnualRowLike; returnPct: number | null } {
  if (override) {
    const vals: AnnualRowLike = {
      beginningBalance: parseFloat(override.beginningBalance),
      totalContributions: parseFloat(override.totalContributions),
      yearlyGainLoss: parseFloat(override.yearlyGainLoss),
      endingBalance: parseFloat(override.endingBalance),
      employerContributions: parseFloat(override.employerContributions),
      distributions: parseFloat(override.distributions),
      fees: parseFloat(override.fees),
      rollovers: parseFloat(override.rollovers),
      lifetimeGains: parseFloat(override.lifetimeGains),
      lifetimeContributions: parseFloat(override.lifetimeContributions),
      lifetimeMatch: parseFloat(override.lifetimeMatch),
    };
    const returnPct = computeReturn(
      vals.beginningBalance,
      vals.totalContributions,
      vals.yearlyGainLoss,
      vals.employerContributions,
      vals.distributions,
      vals.fees,
      vals.rollovers,
    );
    return { values: vals, returnPct };
  }

  const sums = sumAccounts(catAccounts);
  const ltGains = prevLifetime.lifetimeGains + sums.gainLoss;
  const ltContribs = prevLifetime.lifetimeContributions + sums.contribs;
  const ltMatch = prevLifetime.lifetimeMatch + sums.employer;
  const returnPct = computeReturn(
    sums.beginBal,
    sums.contribs,
    sums.gainLoss,
    sums.employer,
    sums.distributions,
    sums.fees,
    sums.rollovers,
  );

  return {
    values: {
      beginningBalance: sums.beginBal,
      totalContributions: sums.contribs,
      yearlyGainLoss: sums.gainLoss,
      endingBalance: sums.endBal,
      employerContributions: sums.employer,
      distributions: sums.distributions,
      fees: sums.fees,
      rollovers: sums.rollovers,
      lifetimeGains: ltGains,
      lifetimeContributions: ltContribs,
      lifetimeMatch: ltMatch,
    },
    returnPct,
  };
}

/** Resolve the Portfolio row values — either from override or by summing category values. */
export function resolvePortfolioValues(
  categoryValues: AnnualRowLike[],
  override: CategoryOverride | undefined,
): { values: AnnualRowLike; returnPct: number | null } {
  if (override) {
    return resolveCategoryValues([], override, {
      lifetimeGains: 0,
      lifetimeContributions: 0,
      lifetimeMatch: 0,
    });
  }

  const ps = sumAnnualRows(categoryValues);
  const returnPct = computeReturn(
    ps.beginBal,
    ps.contribs,
    ps.gainLoss,
    ps.employer,
    ps.distributions,
    ps.fees,
    ps.rollovers,
  );
  return {
    values: {
      beginningBalance: ps.beginBal,
      totalContributions: ps.contribs,
      yearlyGainLoss: ps.gainLoss,
      endingBalance: ps.endBal,
      employerContributions: ps.employer,
      distributions: ps.distributions,
      fees: ps.fees,
      rollovers: ps.rollovers,
      lifetimeGains: ps.lifetimeGains,
      lifetimeContributions: ps.lifetimeContribs,
      lifetimeMatch: ps.lifetimeMatch,
    },
    returnPct,
  };
}

/**
 * Compute gain/loss from flow fields.
 * gainLoss = endingBalance - beginningBalance - contributions - employer
 *            + distributions - rollovers + fees
 */
export function computeGainLoss(input: {
  endingBalance: number;
  beginningBalance: number;
  totalContributions: number;
  employerContributions: number;
  distributions: number;
  rollovers: number;
  fees: number;
}): number {
  return (
    input.endingBalance -
    input.beginningBalance -
    input.totalContributions -
    input.employerContributions +
    input.distributions -
    input.rollovers +
    input.fees
  );
}

/** Minimal account shape for next-year seeding decisions. */
export type SeedableAccount = {
  isActive: boolean;
  performanceAccountId: number | null;
};

/**
 * Filter finalized accounts to determine which should be seeded into the next year.
 * Only active accounts whose master record is also active qualify.
 */
export function filterAccountsForNextYear<T extends SeedableAccount>(
  finalizedAccts: T[],
  activeMasterIds: Set<number>,
): T[] {
  return finalizedAccts.filter((a) => {
    if (!a.isActive) return false;
    if (a.performanceAccountId && !activeMasterIds.has(a.performanceAccountId))
      return false;
    return true;
  });
}

/** Build a dedup key set for account_performance rows. */
export function buildAccountKeys(
  accounts: {
    institution: string;
    accountLabel: string;
    ownerPersonId: number | null;
  }[],
): Set<string> {
  return new Set(
    accounts.map(
      (a) => `${a.institution}:${a.accountLabel}:${a.ownerPersonId ?? ""}`,
    ),
  );
}

/** The net worth values structure for a finalized year. */
export type NetWorthValues = {
  yearEndDate: string;
  grossIncome: string;
  portfolioTotal: string;
  cash: string;
  houseValue: string;
  otherAssets: string;
  mortgageBalance: string;
  otherLiabilities: string;
  homeImprovementsCumulative: string;
  propertyTaxes: string | null;
};

/**
 * Assemble the net worth row values from component data.
 * Pure aggregation — no DB access needed.
 */
export function assembleNetWorthValues(data: {
  yearEndDate: string;
  grossIncome: number;
  portfolioTotal: number;
  cash: number;
  houseValue: number;
  otherAssets: number;
  mortgageBalance: number;
  otherLiabilities: number;
  homeImprovements: number;
  propertyTaxes: number;
}): NetWorthValues {
  return {
    yearEndDate: data.yearEndDate,
    grossIncome: data.grossIncome.toFixed(2),
    portfolioTotal: data.portfolioTotal.toFixed(2),
    cash: data.cash.toFixed(2),
    houseValue: data.houseValue.toFixed(2),
    otherAssets: data.otherAssets.toFixed(2),
    mortgageBalance: data.mortgageBalance.toFixed(2),
    otherLiabilities: data.otherLiabilities.toFixed(2),
    homeImprovementsCumulative: data.homeImprovements.toFixed(2),
    propertyTaxes:
      data.propertyTaxes > 0 ? data.propertyTaxes.toFixed(2) : null,
  };
}

/**
 * Compute portfolio total from finalized account rows.
 */
export function computePortfolioTotal(
  accounts: { endingBalance: string | null }[],
): number {
  return accounts.reduce((sum, a) => sum + toNumber(a.endingBalance), 0);
}

/**
 * Compute cumulative home improvements up to a given year.
 */
export function computeHomeImprovementsCumulative(
  items: { year: number; cost: string | null }[],
  upToYear: number,
): number {
  return items
    .filter((hi) => hi.year <= upToYear)
    .reduce((sum, hi) => sum + toNumber(hi.cost), 0);
}

/**
 * Find active jobs at a given date.
 */
export function filterActiveJobsAtDate<
  T extends { startDate: string; endDate: string | null },
>(jobs: T[], asOfDate: Date): T[] {
  return jobs.filter(
    (j) =>
      new Date(j.startDate) <= asOfDate &&
      (!j.endDate || new Date(j.endDate) >= asOfDate),
  );
}
