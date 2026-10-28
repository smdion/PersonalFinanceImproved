/**
 * Pure business logic extracted from the performance router's finalizeYear transaction.
 * These functions compute values without any DB or I/O dependency.
 */
import { toNumber } from "@/server/helpers/transforms";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { HALF_CENT } from "@/lib/constants";

/**
 * Modified Dietz return: gainLoss / (beginBal + netFlows/2).
 * contribs = totalContributions (employee + employer combined).
 * Returns null when denominator is zero (no capital at risk).
 */
export function computeReturn(
  beginBal: number,
  contribs: number,
  gainLoss: number,
  distributions: number,
  fees: number = 0,
  rollovers: number = 0,
): number | null {
  const denominator =
    beginBal + (contribs + rollovers - distributions - fees) / 2;
  return safeDivide(gainLoss, denominator, null);
}

export type ChainedReturn = {
  /** Cumulative total return across all included years: ∏(1+rᵢ) - 1 */
  cumulativeReturn: number | null;
  /** Annualized/CAGR: ∏(1+rᵢ)^(1/n) - 1, using n = number of included years */
  annualizedReturn: number | null;
  /** Count of years actually included in the chain (nulls excluded) */
  yearsIncluded: number;
};

/**
 * Chain-link a sequence of per-year returns (e.g. from computeReturn) into a
 * cumulative total return and an annualized (CAGR) return. Null per-year
 * returns (no capital at risk that year — computeReturn's zero-denominator
 * case) are excluded from the chain, not treated as 0%.
 *
 * Geometric-linking (∏(1+rᵢ)) is the standard way to combine period returns
 * regardless of the intra-period methodology — here that's Simple Dietz, so
 * the result compounds that same approximation rather than introducing a new
 * error class. Worth disclosing in the UI, not worth avoiding.
 */
export function chainReturns(yearlyReturns: (number | null)[]): ChainedReturn {
  const usable = yearlyReturns.filter((r): r is number => r !== null);
  if (usable.length === 0) {
    return { cumulativeReturn: null, annualizedReturn: null, yearsIncluded: 0 };
  }
  const growth = usable.reduce((acc, r) => acc * (1 + r), 1);
  const cumulativeReturn = growth - 1;
  // Math.pow of a negative base with a fractional exponent is NaN — a single
  // year worse than -100% (possible when fees/distributions dominate) can
  // push growth negative. Cumulative is still well-defined; CAGR isn't.
  const annualizedReturn =
    growth < 0
      ? null
      : usable.length === 1
        ? usable[0]!
        : Math.pow(growth, 1 / usable.length) - 1;
  return { cumulativeReturn, annualizedReturn, yearsIncluded: usable.length };
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

export type AccountRowLike = AccountLike & {
  performanceAccountId: number | null;
  year: number;
};

/**
 * Filter+bucket account rows by a selected account-ID subset and inclusive
 * year range, then sum each year into a per-year aggregate via sumAccounts
 * + computeReturn. Years with zero matching accounts are omitted from the
 * result (no synthetic zero rows) — an account closed mid-range simply has
 * no row in later years, same as the router's own year-by-year data shape.
 */
export function aggregateAccountsByYear(
  rows: AccountRowLike[],
  selectedAccountIds: Set<number>,
  yearRange: { start: number; end: number },
): Array<
  { year: number } & ReturnType<typeof sumAccounts> & {
      returnPct: number | null;
    }
> {
  const matches = (r: AccountRowLike) =>
    r.performanceAccountId != null &&
    selectedAccountIds.has(r.performanceAccountId) &&
    r.year >= yearRange.start &&
    r.year <= yearRange.end;

  const years = Array.from(
    new Set(rows.filter(matches).map((r) => r.year)),
  ).sort((a, b) => a - b);

  return years.map((year) => {
    const yearRows = rows.filter((r) => r.year === year && matches(r));
    const sums = sumAccounts(yearRows);
    const returnPct = computeReturn(
      sums.beginBal,
      sums.contribs,
      sums.gainLoss,
      sums.distributions,
      sums.fees,
      sums.rollovers,
    );
    return { year, ...sums, returnPct };
  });
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
 * gainLoss = endingBalance - beginningBalance - contributions
 *            + distributions - rollovers + fees
 *
 * ROLLOVERS ARE ALWAYS SUBTRACTED, in BOTH directions. A rollover moves
 * principal between accounts — it is never investment return — so it must be
 * removed from G/L on whichever side records it. Sign handles the direction:
 *
 * - Outgoing (negative, e.g. ESPP → brokerage on the ESPP side): subtracting a
 *   negative adds it back, cancelling the outflow that shrank the ending balance.
 * - Incoming (positive, e.g. a destination account receiving ESPP proceeds): the
 *   destination's ending balance ALREADY INCLUDES the wired-in money, so
 *   subtracting it strips out the transferred principal and leaves only true
 *   return. Worked example: a destination account receives a +6,187.62 rollover
 *   from a tracked ESPP source; begin 1,264.76 + rollover 6,187.62 + 366.29 gain
 *   = ending 7,818.67. Without the subtraction the 6,187.62 of transferred
 *   principal would be mis-reported as a gain.
 *
 * GOTCHA: a rollover from another tracked account belongs in `rollovers` ONLY —
 * never also in `totalContributions`. Recording it in both double-counts the
 * principal and produces a phantom loss. (An earlier "fix" stopped subtracting
 * incoming rollovers to mask exactly that mis-entry; the real fix is to enter
 * the transfer once, as a rollover. See tests/pure/performance.test.ts.)
 */
export function computeGainLoss(input: {
  endingBalance: number;
  beginningBalance: number;
  /** Employee + employer contributions combined. */
  totalContributions: number;
  distributions: number;
  rollovers: number;
  fees: number;
}): number {
  return (
    input.endingBalance -
    input.beginningBalance -
    input.totalContributions +
    input.distributions -
    input.rollovers +
    input.fees
  );
}

/** A year's money figures for one category: what `sumAccounts` returns. */
export type Rollup = ReturnType<typeof sumAccounts>;

const ROLLUP_FIELDS = [
  "beginBal",
  "contribs",
  "gainLoss",
  "endBal",
  "employer",
  "distributions",
  "fees",
  "rollovers",
] as const satisfies readonly (keyof Rollup)[];

/** Sum a year's account rows per category (`categoryOf` names each row's). */
export function rollupByCategory<T extends AccountLike>(
  rows: T[],
  categoryOf: (row: T) => string,
): Map<string, Rollup> {
  const byCategory = new Map<string, T[]>();
  for (const r of rows) {
    const cat = categoryOf(r);
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), r]);
  }
  return new Map(
    Array.from(byCategory, ([cat, catRows]) => [cat, sumAccounts(catRows)]),
  );
}

/** a + b, field by field. */
export function addRollups(a: Rollup, b: Rollup): Rollup {
  const out = { ...a };
  for (const f of ROLLUP_FIELDS) out[f] = a[f] + b[f];
  return out;
}

/**
 * What an edit moved, per category: after − before. A category whose every
 * figure moved by under half a cent is left out, so an edit that changes
 * nothing (or only a label) changes no rollup.
 */
export function rollupDeltas(
  before: Map<string, Rollup>,
  after: Map<string, Rollup>,
): Map<string, Rollup> {
  const zero = sumAccounts([]);
  const deltas = new Map<string, Rollup>();
  for (const cat of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(cat) ?? zero;
    const a = after.get(cat) ?? zero;
    const d = { ...zero };
    for (const f of ROLLUP_FIELDS) d[f] = a[f] - b[f];
    if (ROLLUP_FIELDS.some((f) => Math.abs(d[f]) >= HALF_CENT))
      deltas.set(cat, d);
  }
  return deltas;
}

/**
 * A finalized year's return after its figures move by `delta`.
 *
 * The stored return can't always be reproduced from the row (it may be an
 * override entered at finalize, a provider's figure, or imported history),
 * so its basis is kept: the capital it was measured against
 * (gain ÷ return) moves only by the capital the edit moved, weighted the way
 * `computeReturn` weighs it. With no stored return (or a zero one, which
 * says nothing about its basis) the return is computed from the new figures.
 */
export function rebaseLockedReturn(
  prev: {
    beginningBalance: number;
    totalContributions: number;
    yearlyGainLoss: number;
    distributions: number;
    fees: number;
    rollovers: number;
    annualReturnPct: number | null;
  },
  delta: Rollup,
): number | null {
  const gain = prev.yearlyGainLoss + delta.gainLoss;
  if (
    prev.annualReturnPct == null ||
    prev.annualReturnPct === 0 ||
    prev.yearlyGainLoss === 0
  ) {
    return computeReturn(
      prev.beginningBalance + delta.beginBal,
      prev.totalContributions + delta.contribs,
      gain,
      prev.distributions + delta.distributions,
      prev.fees + delta.fees,
      prev.rollovers + delta.rollovers,
    );
  }
  const capital =
    prev.yearlyGainLoss / prev.annualReturnPct +
    delta.beginBal +
    (delta.contribs + delta.rollovers - delta.distributions - delta.fees) / 2;
  return safeDivide(gain, capital, null);
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
  return sumBy(accounts, (a) => toNumber(a.endingBalance));
}

/**
 * Account fees (the Performance Fees column) for `year` and the year before,
 * summed over every account row; null for a year with no rows. Fund costs
 * (expense ratios) are not in here — they're inside the funds' prices.
 */
export function accountFeesForYears(
  rows: readonly { year: number; fees: string | null }[],
  year: number,
): { year: number; thisYear: number | null; lastYear: number | null } {
  const sum = (y: number) => {
    const ofYear = rows.filter((r) => r.year === y);
    return ofYear.length === 0 ? null : sumBy(ofYear, (r) => toNumber(r.fees));
  };
  return { year, thisYear: sum(year), lastYear: sum(year - 1) };
}

/** A year of investment cost, both kinds: fund costs at today's rate plus
 *  the last full year's account fees (this year's so far when there's no
 *  full year yet). Null when neither is known. */
export function allInYearlyCost(
  fundYearlyCost: number | null,
  fees: { thisYear: number | null; lastYear: number | null },
): number | null {
  const account = fees.lastYear ?? fees.thisYear;
  if (fundYearlyCost === null && account === null) return null;
  return (fundYearlyCost ?? 0) + (account ?? 0);
}
