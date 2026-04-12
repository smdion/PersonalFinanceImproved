/**
 * Account drift detection for budget API mappings (v0.5 expert-review M21).
 *
 * The audit's concern: when a YNAB or Actual account is renamed or deleted,
 * the local mapping silently breaks (lookup returns undefined, sync skips
 * the row, user sees nothing). This module detects drift by diffing the
 * cached account list against the freshly-fetched one and produces a
 * structured report the UI can render as actionable callouts.
 */

import type { BudgetAccount } from "./types";
import type { AccountMapping } from "./types";

export interface DriftReport {
  /** Mappings whose remote account no longer exists in the latest fetch. */
  brokenMappings: BrokenMapping[];
  /** Accounts that exist in the new fetch but didn't in the cache (informational). */
  newRemoteAccounts: BudgetAccount[];
  /** Accounts whose name changed between cache and new fetch. */
  renamedAccounts: RenamedAccount[];
}

export interface BrokenMapping {
  remoteAccountId: string;
  /** The local-side identifier (mortgage:1, asset:5, etc.). */
  localId: string;
  /** Last-known remote name from the cached account list, if any. */
  lastKnownName: string | null;
  reason: "deleted" | "id-changed";
}

export interface RenamedAccount {
  remoteAccountId: string;
  oldName: string;
  newName: string;
}

/**
 * Diff the previous cached account list against the new fetch. Returns
 * a structured report listing broken mappings, renames, and new
 * accounts. The sync layer should attach this to the sync result so
 * the UI can render callouts.
 */
export function detectDrift(
  cachedAccounts: BudgetAccount[],
  newAccounts: BudgetAccount[],
  mappings: AccountMapping[],
): DriftReport {
  const cachedById = new Map(cachedAccounts.map((a) => [a.id, a]));
  const newById = new Map(newAccounts.map((a) => [a.id, a]));

  const brokenMappings: BrokenMapping[] = [];
  for (const mapping of mappings) {
    const newAcct = newById.get(mapping.remoteAccountId);
    if (!newAcct) {
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
  for (const newAcct of newAccounts) {
    const cached = cachedById.get(newAcct.id);
    if (cached && cached.name !== newAcct.name) {
      renamedAccounts.push({
        remoteAccountId: newAcct.id,
        oldName: cached.name,
        newName: newAcct.name,
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
