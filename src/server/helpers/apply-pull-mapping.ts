/**
 * Shared "apply one pull mapping" logic for budget-API account sync.
 *
 * Used by `syncAll`'s pull loop (assets, mortgage and debt mappings alike); the
 * caller passes its own `db`/`tx`, so atomicity is the caller's choice.
 */

import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountMapping } from "@/lib/db/schema";
import { localDateStr } from "@/lib/utils/date";
import { log } from "@/lib/logger";
import { loansFedBySimplefin } from "./loan-feed";
import {
  isPullMapping,
  mappingsWithTypedIds,
} from "@/lib/utils/account-mapping";
import { toDecimalColumn } from "@/lib/utils/math";
import type { Db } from "@/lib/db";

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
    currentYear,
  }: {
    mapping: AccountMapping;
    apiBalance: number;
    service: string;
    currentYear: number;
  },
): Promise<ApplyPullMappingResult> {
  const localId = mapping.localId ?? mapping.localName; // backward compat

  // "cash" / "creditCard" are fixed pseudo-accounts (see AccountMapping's
  // docblock, schema-pg.ts) — many mappings can share one, summed live by
  // getEffectiveCash / getEffectiveCreditCardDebt straight from the
  // accounts cache. They never resolve to a single local row the way
  // mortgage/asset mappings do, so there's nothing for this per-mapping
  // pipeline to write; falling through to the asset branch below would
  // have written into an otherAssetItems row literally named "Cash",
  // repeatedly overwritten by whichever mapping happened to sync last.
  if (localId === "cash" || localId === "creditCard") {
    return { applied: false };
  }

  // A debt's balance, written like the mortgage loan balance below.
  if (mapping.debtId != null || localId.startsWith("debt:")) {
    const debtId = mapping.debtId ?? parseInt(localId.split(":")[1]!, 10);
    const updated = await db
      .update(schema.debts)
      .set({
        apiBalance: toDecimalColumn(
          Math.abs(apiBalance),
          "a balance from the budget app",
        ),
        apiBalanceDate: localDateStr(),
      })
      .where(eq(schema.debts.id, debtId))
      .returning({ id: schema.debts.id });
    // A deleted debt: nothing to write (as for a deleted asset).
    return updated.length > 0
      ? { applied: true, kind: "debt" }
      : { applied: false };
  }

  // Prefer typed fields; fall back to prefix parsing for legacy mappings.
  if (mapping.loanId || localId.startsWith("mortgage:")) {
    const loanId = mapping.loanId ?? Number(localId.split(":")[1]);
    const mapType = mapping.loanMapType ?? localId.split(":")[2]; // 'propertyValue' or 'loanBalance'

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
          apiBalanceDate: localDateStr(),
        })
        .where(eq(schema.mortgageLoans.id, loanId));
      return { applied: true, kind: "mortgageLoanBalance" };
    }
    return { applied: false };
  }

  // Only target kinds this pipeline knows are written. A portfolio
  // (`performance:`) account is push-only — its balance is already in net
  // worth from the snapshot, so falling through to the asset branch below
  // would write it a second time as an other_asset_items row. Anything else
  // with a prefix we don't know is skipped the same way. A localId with no
  // prefix at all (a plain name) is a legacy asset mapping, kept working.
  const isAssetTarget =
    mapping.assetId != null ||
    localId.startsWith("asset:") ||
    !/^[a-z]+:\d/.test(localId);
  if (mapping.performanceAccountId != null || !isAssetTarget) {
    log("warn", "apply_pull_mapping.unsupported_target", {
      localId,
      localName: mapping.localName,
      remoteAccountId: mapping.remoteAccountId,
    });
    return { applied: false };
  }

  // Resolve asset name: prefer the typed ID over the (possibly stale) localName.
  let assetName = mapping.localName;
  if (mapping.assetId != null || localId.startsWith("asset:")) {
    const assetId = mapping.assetId ?? parseInt(localId.split(":")[1]!, 10);
    const assetRow = await db
      .select()
      .from(schema.otherAssetItems)
      .where(eq(schema.otherAssetItems.id, assetId))
      .then((r) => r[0]);
    // Typed mapping whose target row no longer exists (e.g. asset deleted).
    // Skip rather than writing under the stale localName — resurrecting a
    // deleted asset by name would be worse than silently not syncing it.
    if (!assetRow) return { applied: false };
    assetName = assetRow.name;
  }

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
 * Clear pulled balances nothing pulls any more — a debt or mortgage loan
 * whose mapping was removed (or whose connection was deleted) goes back to
 * its own balance instead of keeping the last pulled one forever.
 */
export async function clearUnmappedPulledBalances(db: Db): Promise<void> {
  const conns = await db
    .select({ accountMappings: schema.apiConnections.accountMappings })
    .from(schema.apiConnections);
  const pulled = mappingsWithTypedIds(
    conns.flatMap((c) => c.accountMappings ?? []),
  ).filter(isPullMapping);
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
