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
 * A portfolio snapshot account's display label. A per-owner row (ownerPersonId set) shows
 * that person's name even under a jointly tracked performance account.
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
