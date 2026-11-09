/**
 * Shared label resolution for a portfolio snapshot account row, so every
 * reader labels a jointly-tracked account's per-owner rows the same way
 * (RULES.md Single Computation Path).
 */
import { accountDisplayName } from "@/lib/utils/account-name";

type PortfolioLabelAccount = {
  accountType: string;
  subType: string | null;
  label: string | null;
  institution: string;
};

type PortfolioLabelPerf =
  | {
      displayName: string | null;
      accountLabel: string | null;
      ownershipType: string | null;
    }
  | undefined;

/**
 * Resolve a portfolio snapshot account's display label, correctly
 * distinguishing per-owner rows on a jointly-tracked performance account.
 *
 * A person-specific holding row (ownerPersonId set) takes precedence over
 * the shared performance account's own ownership designation — e.g. a
 * jointly-tracked IRA where Alex's and Sam's balances are recorded as
 * separate portfolio_accounts rows under one performance account should
 * still display each person's own name, not "Joint", for that row. This
 * mirrors the same precedence rule contribution-profiles.ts's
 * compareData/getById already use for the analogous contribution-row
 * case — a display heuristic here (per-holding owner attribution), not a
 * definitional fact the way per-person contribution limits are there.
 */
export function portfolioAccountLabel(
  account: PortfolioLabelAccount,
  perf: PortfolioLabelPerf,
  ownerPersonId: number | null,
  peopleMap: Map<number, string>,
): string {
  const ownerName =
    ownerPersonId != null ? peopleMap.get(ownerPersonId) : undefined;
  const ownershipType =
    ownerPersonId != null ? "individual" : (perf?.ownershipType ?? null);
  return accountDisplayName(
    {
      accountType: account.accountType,
      subType: account.subType,
      label: account.label,
      institution: account.institution,
      displayName: perf?.displayName ?? null,
      accountLabel: perf?.accountLabel ?? null,
      ownershipType,
    },
    ownerName ?? undefined,
  );
}
