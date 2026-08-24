/**
 * Shared label resolution for a portfolio snapshot account row. Extracted
 * after the identical block drifted three independent ways across
 * sync/core.ts, sync/mappings.ts, and lib/db/backfill-local-ids.ts — one
 * of the three didn't even pass ownershipType, so a jointly-tracked
 * account's per-owner rows rendered inconsistently between them (see
 * RULES.md Single Computation Path).
 */
import { accountDisplayName } from "@/lib/utils/format";

export type PortfolioLabelAccount = {
  accountType: string;
  subType: string | null;
  label: string | null;
  institution: string;
};

export type PortfolioLabelPerf =
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
 * jointly-tracked IRA where Sean's and Joanna's balances are recorded as
 * separate portfolio_accounts rows under one performance account should
 * still display each person's own name, not "Joint", for that row. This
 * mirrors the same precedence rule contribution-profiles.ts's
 * compareData/getById already use for the analogous contribution-row
 * case — a display heuristic here (per-holding owner attribution), not a
 * definitional fact the way per-person contribution limits are there.
 */
export function portfolioAccountLabel(
  acct: PortfolioLabelAccount,
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
      accountType: acct.accountType,
      subType: acct.subType,
      label: acct.label,
      institution: acct.institution,
      displayName: perf?.displayName ?? null,
      accountLabel: perf?.accountLabel ?? null,
      ownershipType,
    },
    ownerName ?? undefined,
  );
}
