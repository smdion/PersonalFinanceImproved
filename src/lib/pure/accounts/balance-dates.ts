/**
 * How current linked balances are, per institution (Live Balance card footer). Dates are
 * valuation dates, so Saturday's report counts as Friday's close; an institution is as
 * current as its least current account.
 */
import {
  tradingDaysBetween,
  valuationDateFor,
} from "../investments/market-calendar";

type AccountBalanceDate = {
  institution: string;
  /** When the balance is from — the institution's as-of time, or when Ledgr saw it if not reported. */
  reportedAt: Date;
};

type InstitutionBalanceDate = {
  institution: string;
  /** Valuation date (YYYY-MM-DD) of the institution's least current account. */
  asOf: string;
  /** Trading days behind the most current institution. */
  tradingDaysBehind: number;
};

type BalanceDateSummary = {
  /** Least current first. */
  institutions: InstitutionBalanceDate[];
  oldest: string | null;
  newest: string | null;
  /** Institutions at least one full trading day behind the most current. */
  behind: InstitutionBalanceDate[];
};

export function summarizeBalanceDates(
  accounts: readonly AccountBalanceDate[],
): BalanceDateSummary {
  const byInstitution = new Map<string, string>();
  for (const a of accounts) {
    const day = valuationDateFor(a.reportedAt);
    const prev = byInstitution.get(a.institution);
    if (!prev || day < prev) byInstitution.set(a.institution, day);
  }
  if (byInstitution.size === 0)
    return { institutions: [], oldest: null, newest: null, behind: [] };

  const days = [...byInstitution.values()].sort();
  const oldest = days[0]!;
  const newest = days[days.length - 1]!;
  const institutions = [...byInstitution.entries()]
    .map(([institution, asOf]) => ({
      institution,
      asOf,
      tradingDaysBehind: tradingDaysBetween(asOf, newest),
    }))
    .sort(
      (a, b) =>
        a.asOf.localeCompare(b.asOf) ||
        a.institution.localeCompare(b.institution),
    );
  return {
    institutions,
    oldest,
    newest,
    behind: institutions.filter((i) => i.tradingDaysBehind >= 1),
  };
}
