import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import type { loadLiveContribData } from "@/server/services/contributions/live-data";

type LiveData = Awaited<ReturnType<typeof loadLiveContribData>>;

/**
 * A contribution account's name before sibling disambiguation: its linked
 * performance account's label, else one built from its type, label and
 * institution (the owner's current employer stands in for an unlinked row).
 */
export function contributionAccountName(
  row: LiveData["rawContribRows"][number],
  live: Pick<LiveData, "perfAccountMap" | "jobs">,
  nameMap: Map<number, string>,
): string {
  const linked =
    row.performanceAccountId != null
      ? live.perfAccountMap.get(row.performanceAccountId)
      : undefined;
  const institution =
    linked?.institution ??
    live.jobs.find(
      (j) => j.personId === row.personId && !j.endDate && !j.isSpeculative,
    )?.employerName ??
    "";
  // A row with its own personId is person-specific (limits are per person) even
  // under a jointly tracked account, so it gets its owner's label; joint rows
  // (personId null) use the account's ownershipType (portfolio-labels.ts).
  return portfolioAccountLabel(
    {
      accountType: row.accountType,
      subType: row.subType,
      label: row.label,
      institution,
    },
    linked
      ? {
          displayName: linked.displayName,
          accountLabel: linked.accountLabel,
          ownershipType: linked.ownershipType,
        }
      : undefined,
    row.personId,
    nameMap,
  );
}
