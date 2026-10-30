/**
 * Account-mapping utilities. Single source for deriving the typed ID fields
 * (`performanceAccountId` / `assetId` / `debtId` / `loanId` + `loanMapType`) from the
 * legacy `localId` prefix string.
 *
 * The schema's typed fields are canonical. The UI carries `localId` strings
 * for backwards compatibility with select-option values, so every write path
 * must run mappings through `mappingWithTypedIds()` before persisting them
 * to guarantee the typed fields stay populated and `localId` is just
 * a UI breadcrumb.
 */

import type { AccountMapping } from "@/lib/db/schema";

const PERFORMANCE_PREFIX = "performance:";
const ASSET_PREFIX = "asset:";
const MORTGAGE_PREFIX = "mortgage:";
const DEBT_PREFIX = "debt:";

/**
 * Derive typed ID fields from `localId` and return a normalized mapping.
 * If a typed field is already set, it wins (we never overwrite explicit data).
 * If `localId` is missing or unrecognized, the mapping is returned unchanged.
 */
export function mappingWithTypedIds(mapping: AccountMapping): AccountMapping {
  const localId = mapping.localId;
  if (!localId) return mapping;

  if (localId.startsWith(PERFORMANCE_PREFIX)) {
    if (mapping.performanceAccountId != null) return mapping;
    const performanceAccountId = parseIntStrict(
      localId.slice(PERFORMANCE_PREFIX.length),
    );
    if (performanceAccountId == null) return mapping;
    return { ...mapping, performanceAccountId };
  }

  if (localId.startsWith(ASSET_PREFIX)) {
    if (mapping.assetId != null) return mapping;
    const assetId = parseIntStrict(localId.slice(ASSET_PREFIX.length));
    if (assetId == null) return mapping;
    return { ...mapping, assetId };
  }

  if (localId.startsWith(DEBT_PREFIX)) {
    if (mapping.debtId != null) return mapping;
    const debtId = parseIntStrict(localId.slice(DEBT_PREFIX.length));
    if (debtId == null) return mapping;
    return { ...mapping, debtId };
  }

  if (localId.startsWith(MORTGAGE_PREFIX)) {
    if (mapping.loanId != null && mapping.loanMapType != null) return mapping;
    // Format: "mortgage:{loanId}:{propertyValue|loanBalance}"
    const rest = localId.slice(MORTGAGE_PREFIX.length).split(":");
    if (rest.length !== 2) return mapping;
    const loanId = parseIntStrict(rest[0]!);
    const loanMapType = rest[1];
    if (
      loanId == null ||
      (loanMapType !== "propertyValue" && loanMapType !== "loanBalance")
    ) {
      return mapping;
    }
    return { ...mapping, loanId, loanMapType };
  }

  return mapping;
}

/** Targets that only take a pulled balance: the Cash and Credit Card
 *  pseudo-accounts and debts (Ledgr has no figure of its own to push). */
export function isPullOnlyLocalId(localId: string): boolean {
  return (
    localId === "cash" ||
    localId === "creditCard" ||
    localId.startsWith(DEBT_PREFIX)
  );
}

/** Pulls the balance into Ledgr (pull or both). */
export function isPullMapping(m: AccountMapping): boolean {
  return m.syncDirection === "pull" || m.syncDirection === "both";
}

/**
 * Budget accounts whose pulled balance would land in more than one place —
 * two pulled mappings on one remote account count it twice (say, as a
 * credit card and again as a debt). Each such remote id, once.
 */
export function remotesPulledTwice(mappings: AccountMapping[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const m of mappings.filter(isPullMapping)) {
    if (seen.has(m.remoteAccountId)) twice.add(m.remoteAccountId);
    seen.add(m.remoteAccountId);
  }
  return [...twice];
}

/** Apply `mappingWithTypedIds` to every entry in an array. */
export function mappingsWithTypedIds(
  mappings: AccountMapping[],
): AccountMapping[] {
  return mappings.map(mappingWithTypedIds);
}

function parseIntStrict(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
