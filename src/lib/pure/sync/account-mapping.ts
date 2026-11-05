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

import type { ApiSyncDirection } from "@/lib/config/enum-values";

/** The fields of a stored sync mapping (the schema's `AccountMapping`) that
 *  these rules read and set. Each function takes the caller's own mapping
 *  type, so the schema's extra fields pass through. */
type MappingFields = {
  localId?: string;
  remoteAccountId: string;
  syncDirection: ApiSyncDirection;
  assetId?: number;
  loanId?: number;
  loanMapType?: "propertyValue" | "loanBalance";
  debtId?: number;
  performanceAccountId?: number;
};

const PERFORMANCE_PREFIX = "performance:";
const ASSET_PREFIX = "asset:";
const MORTGAGE_PREFIX = "mortgage:";
const DEBT_PREFIX = "debt:";

/**
 * Derive typed ID fields from `localId` and return a normalized mapping.
 * If a typed field is already set, it wins (we never overwrite explicit data).
 * If `localId` is missing or unrecognized, the mapping is returned unchanged.
 */
export function mappingWithTypedIds<M extends MappingFields>(
  mapping: M,
): M & MappingFields {
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

export type SyncDirection = ApiSyncDirection;

/**
 * The sync directions a mapping target allows — one rule per target.
 *  - Cash, Credit Card and debts: pull only (see `isPullOnlyLocalId`).
 *  - Portfolio (`performance:`) accounts: push only. Ledgr's snapshot is the
 *    source of truth for them; a pull would write the balance a second time
 *    as an asset and double-count net worth.
 *  - Assets, mortgage rows and legacy plain-name mappings: any direction.
 */
export function allowedDirectionsForLocalId(localId: string): SyncDirection[] {
  if (isPullOnlyLocalId(localId)) return ["pull"];
  if (localId.startsWith(PERFORMANCE_PREFIX)) return ["push"];
  return ["pull", "push", "both"];
}

/** Same rule for a stored mapping, also honouring its typed ID fields so a
 *  mapping missing its `localId` breadcrumb can't slip past. */
export function allowedDirectionsForMapping<M extends MappingFields>(
  m: M,
): SyncDirection[] {
  if (m.performanceAccountId != null) return ["push"];
  if (m.debtId != null) return ["pull"];
  return allowedDirectionsForLocalId(m.localId ?? "");
}

/** Pulls the balance into Ledgr (pull or both). */
export function isPullMapping<M extends MappingFields>(m: M): boolean {
  return m.syncDirection === "pull" || m.syncDirection === "both";
}

/**
 * Budget accounts whose pulled balance would land in more than one place —
 * two pulled mappings on one remote account count it twice (say, as a
 * credit card and again as a debt). Each such remote id, once.
 */
export function remotesPulledTwice<M extends MappingFields>(
  mappings: M[],
): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const m of mappings.filter(isPullMapping)) {
    if (seen.has(m.remoteAccountId)) twice.add(m.remoteAccountId);
    seen.add(m.remoteAccountId);
  }
  return [...twice];
}

/** The one Ledgr row a pulled balance is written into — a debt, a loan's
 *  balance or property value, an asset — or null for the Cash and Credit
 *  Card pseudo-accounts, which sum every account mapped to them. */
function pulledTarget(m: MappingFields): string | null {
  const t = mappingWithTypedIds(m);
  if (t.debtId != null) return `${DEBT_PREFIX}${t.debtId}`;
  if (t.loanId != null && t.loanMapType != null)
    return `${MORTGAGE_PREFIX}${t.loanId}:${t.loanMapType}`;
  if (t.assetId != null) return `${ASSET_PREFIX}${t.assetId}`;
  return null;
}

/**
 * Ledgr rows two pulled mappings write into — each sync, the last one
 * written wins, silently. Each such target (its `localId` form), once.
 */
export function localTargetsPulledTwice<M extends MappingFields>(
  mappings: M[],
): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const m of mappings.filter(isPullMapping)) {
    const target = pulledTarget(m);
    if (target === null) continue;
    if (seen.has(target)) twice.add(target);
    seen.add(target);
  }
  return [...twice];
}

/** Apply `mappingWithTypedIds` to every entry in an array. */
export function mappingsWithTypedIds<M extends MappingFields>(
  mappings: M[],
): (M & MappingFields)[] {
  return mappings.map(mappingWithTypedIds);
}

function parseIntStrict(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
