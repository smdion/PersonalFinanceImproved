/**
 * Shared "apply one pull mapping" logic for budget-API account sync.
 *
 * Previously duplicated between `syncAll` (transactional, full sync) and
 * `pullAssetsFromApi` (standalone, asset-only). The standalone copy never
 * grew mortgage-mapping support when `syncAll`'s loop did, so a mortgage
 * mapping pulled via `pullAssetsFromApi` alone would silently fall through
 * to the asset branch and write a bogus `other_asset_items` row instead of
 * updating the mortgage loan. Single implementation now; both call sites
 * pass their own `db`/`tx` so atomicity is the caller's choice, but the
 * mapping logic and upsert conflict target can't drift apart again.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountMapping } from "@/lib/db/schema";
import type { Db } from "./transforms";

export type ApplyPullMappingResult =
  | { applied: false }
  | { applied: true; kind: "mortgagePropertyValue" | "mortgageLoanBalance" }
  | { applied: true; kind: "asset" };

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

  // Prefer typed fields; fall back to prefix parsing for legacy mappings.
  if (mapping.loanId || localId.startsWith("mortgage:")) {
    const loanId = mapping.loanId ?? Number(localId.split(":")[1]);
    const mapType = mapping.loanMapType ?? localId.split(":")[2]; // 'propertyValue' or 'loanBalance'

    if (mapType === "propertyValue") {
      await db
        .update(schema.mortgageLoans)
        .set({
          propertyValueEstimated: String(apiBalance),
          usePurchaseOrEstimated: "estimated",
        })
        .where(eq(schema.mortgageLoans.id, loanId));
      return { applied: true, kind: "mortgagePropertyValue" };
    }
    if (mapType === "loanBalance") {
      await db
        .update(schema.mortgageLoans)
        .set({
          apiBalance: String(Math.abs(apiBalance)),
          apiBalanceDate: new Date().toISOString().slice(0, 10),
        })
        .where(eq(schema.mortgageLoans.id, loanId));
      return { applied: true, kind: "mortgageLoanBalance" };
    }
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
        value: String(apiBalance),
        note: `Synced from ${service.toUpperCase()}`,
      })
      .where(eq(schema.otherAssetItems.id, existing.id));
  } else {
    await db.insert(schema.otherAssetItems).values({
      name: assetName,
      year: currentYear,
      value: String(apiBalance),
      note: `Synced from ${service.toUpperCase()}`,
    });
  }
  return { applied: true, kind: "asset" };
}
