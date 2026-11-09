/** Account drift detection for budget API mappings: diffs the cached account
 *  list against a fresh fetch so renamed or deleted remote accounts surface
 *  as callouts instead of silently breaking a mapping. */

import type { BudgetAccount } from "./types";
import type { AccountMapping } from "@/lib/db/schema";

interface DriftReport {
  /** Mappings whose remote account is missing from the latest fetch. */
  brokenMappings: BrokenMapping[];
  /** Accounts that exist in the new fetch but didn't in the cache (informational). */
  newRemoteAccounts: BudgetAccount[];
  /** Accounts whose name changed between cache and new fetch. */
  renamedAccounts: RenamedAccount[];
}

interface BrokenMapping {
  remoteAccountId: string;
  /** The local-side identifier (mortgage:1, asset:5, etc.). */
  localId: string;
  /** Last-known remote name from the cached account list, if any. */
  lastKnownName: string | null;
  reason: "deleted" | "id-changed";
}

interface RenamedAccount {
  remoteAccountId: string;
  oldName: string;
  newName: string;
}

/** Diff the cached account list against the new fetch: broken mappings,
 *  renames and new accounts, for the sync result's UI callouts. */
export function detectDrift(
  cachedAccounts: BudgetAccount[],
  newAccounts: BudgetAccount[],
  mappings: AccountMapping[],
): DriftReport {
  const cachedById = new Map(cachedAccounts.map((a) => [a.id, a]));
  const newById = new Map(newAccounts.map((a) => [a.id, a]));

  const brokenMappings: BrokenMapping[] = [];
  for (const mapping of mappings) {
    const newAccount = newById.get(mapping.remoteAccountId);
    if (!newAccount) {
      const cached = cachedById.get(mapping.remoteAccountId);
      brokenMappings.push({
        remoteAccountId: mapping.remoteAccountId,
        localId: mapping.localId ?? mapping.localName,
        lastKnownName: cached?.name ?? null,
        reason: "deleted",
      });
    }
  }

  const renamedAccounts: RenamedAccount[] = [];
  for (const newAccount of newAccounts) {
    const cached = cachedById.get(newAccount.id);
    if (cached && cached.name !== newAccount.name) {
      renamedAccounts.push({
        remoteAccountId: newAccount.id,
        oldName: cached.name,
        newName: newAccount.name,
      });
    }
  }

  const newRemoteAccounts = newAccounts.filter((a) => !cachedById.has(a.id));

  return { brokenMappings, newRemoteAccounts, renamedAccounts };
}

/** True if the report has anything worth surfacing in the UI. */
export function hasDrift(report: DriftReport): boolean {
  return (
    report.brokenMappings.length > 0 ||
    report.renamedAccounts.length > 0 ||
    report.newRemoteAccounts.length > 0
  );
}
