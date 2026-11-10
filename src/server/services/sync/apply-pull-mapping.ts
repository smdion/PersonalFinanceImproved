/**
 * Shared "apply one pull mapping" logic for budget-API account sync.
 *
 * Used by `syncAll`'s pull loop (assets, mortgage and debt mappings alike); the
 * caller passes its own `db`/`tx`, so atomicity is the caller's choice.
 */

import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountMapping } from "@/lib/db/schema";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { log } from "@/lib/logger";
import { loansFedBySimplefin } from "./loan-feed";
import { isPullMapping } from "@/lib/pure/sync/account-mapping";
import { toDecimalColumn } from "@/lib/utils/math";
import type { Db } from "@/lib/db";
import { firstRow } from "@/lib/utils/first-row";

type ApplyPullMappingResult =
  | { applied: false }
  | { applied: true; kind: "mortgagePropertyValue" | "mortgageLoanBalance" }
  | { applied: true; kind: "asset" }
  | { applied: true; kind: "debt" };

/**
 * Apply a single resolved API balance to whatever local record `mapping`
 * points at (mortgage loan or asset item). `db` may be a live connection or
 * an open transaction — callers own atomicity.
 */
export async function applyPullMapping(
  db: Db,
  {
    mapping,
    apiBalance,
    service,
    pulledAt,
  }: {
    mapping: AccountMapping;
    apiBalance: number;
    service: string;
    /** When the sync read the balance: its date and year. */
    pulledAt: Date;
  },
): Promise<ApplyPullMappingResult> {
  const currentYear = pulledAt.getFullYear();

  // "cash" / "creditCard" are pseudo-accounts summed live from the accounts
  // cache (getEffectiveCash / getEffectiveCreditCardDebt), with no single local
  // row to write.
  if (mapping.localId === "cash" || mapping.localId === "creditCard") {
    return { applied: false };
  }

  // A debt's balance, written like the mortgage loan balance below.
  if (mapping.debtId != null) {
    const debtId = mapping.debtId;
    const updated = await db
      .update(schema.debts)
      .set({
        apiBalance: toDecimalColumn(
          Math.abs(apiBalance),
          "a balance from the budget app",
        ),
        apiBalanceDate: calendarDateOf(pulledAt),
      })
      .where(eq(schema.debts.id, debtId))
      .returning({ id: schema.debts.id });
    // A deleted debt: nothing to write (as for a deleted asset).
    return updated.length > 0
      ? { applied: true, kind: "debt" }
      : { applied: false };
  }

  if (mapping.loanId != null) {
    const loanId = mapping.loanId;
    const mapType = mapping.loanMapType;

    if (mapType === "propertyValue") {
      await db
        .update(schema.mortgageLoans)
        // The value only: purchase vs estimated is the household's choice.
        .set({
          propertyValueEstimated: toDecimalColumn(
            apiBalance,
            "a property value from the budget app",
          ),
        })
        .where(eq(schema.mortgageLoans.id, loanId));
      return { applied: true, kind: "mortgagePropertyValue" };
    }
    if (mapType === "loanBalance") {
      // The servicer's own feed outranks a budget app's figure.
      if ((await loansFedBySimplefin(db)).has(loanId))
        return { applied: false };
      await db
        .update(schema.mortgageLoans)
        .set({
          apiBalance: toDecimalColumn(
            Math.abs(apiBalance),
            "a balance from the budget app",
          ),
          apiBalanceDate: calendarDateOf(pulledAt),
        })
        .where(eq(schema.mortgageLoans.id, loanId));
      return { applied: true, kind: "mortgageLoanBalance" };
    }
    return { applied: false };
  }

  // Only an asset is written below. A portfolio account is push-only (the
  // asset branch would count it twice); a mapping with no typed id (a name
  // the credentials migration matched to no asset) is skipped until re-mapped.
  if (mapping.assetId == null) {
    log("warn", "apply_pull_mapping.unsupported_target", {
      localId: mapping.localId ?? null,
      remoteAccountId: mapping.remoteAccountId,
      typed: mapping.performanceAccountId != null,
    });
    return { applied: false };
  }

  // The asset's name, from its row (the mapping's localName may be stale).
  const assetRow = await db
    .select()
    .from(schema.otherAssetItems)
    .where(eq(schema.otherAssetItems.id, mapping.assetId))
    .then(firstRow);
  // Its row is gone (the asset was deleted): skip rather than resurrect it.
  if (!assetRow) return { applied: false };
  const assetName = assetRow.name;

  const existing = await db
    .select()
    .from(schema.otherAssetItems)
    .where(eq(schema.otherAssetItems.name, assetName))
    .then((rows) => rows.find((r) => r.year === currentYear));

  if (existing) {
    await db
      .update(schema.otherAssetItems)
      .set({
        value: toDecimalColumn(
          apiBalance,
          "an asset value from the budget app",
        ),
        note: `Synced from ${service.toUpperCase()}`,
      })
      .where(eq(schema.otherAssetItems.id, existing.id));
  } else {
    await db.insert(schema.otherAssetItems).values({
      name: assetName,
      year: currentYear,
      value: toDecimalColumn(apiBalance, "an asset value from the budget app"),
      note: `Synced from ${service.toUpperCase()}`,
    });
  }
  return { applied: true, kind: "asset" };
}

/**
 * Clear pulled balances nothing pulls: a debt or mortgage loan with no mapping (or connection)
 * goes back to its own balance instead of keeping the last pulled one.
 */
export async function clearUnmappedPulledBalances(db: Db): Promise<void> {
  const conns = await db
    .select({ accountMappings: schema.apiConnections.accountMappings })
    .from(schema.apiConnections);
  const pulled = conns
    .flatMap((c) => c.accountMappings ?? [])
    .filter(isPullMapping);
  const debtIds = pulled.flatMap((m) => (m.debtId != null ? [m.debtId] : []));
  const loanIds = [
    ...pulled.flatMap((m) =>
      m.loanId != null && m.loanMapType === "loanBalance" ? [m.loanId] : [],
    ),
    ...(await loansFedBySimplefin(db)),
  ];
  await db
    .update(schema.debts)
    .set({ apiBalance: null, apiBalanceDate: null })
    .where(
      and(
        isNotNull(schema.debts.apiBalance),
        debtIds.length > 0 ? notInArray(schema.debts.id, debtIds) : undefined,
      ),
    );
  await db
    .update(schema.mortgageLoans)
    .set({ apiBalance: null, apiBalanceDate: null })
    .where(
      and(
        isNotNull(schema.mortgageLoans.apiBalance),
        loanIds.length > 0
          ? notInArray(schema.mortgageLoans.id, loanIds)
          : undefined,
      ),
    );
}
