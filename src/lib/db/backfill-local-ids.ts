/**
 * Auto-backfill localId on account mappings that only have localName.
 *
 * Runs on startup (via instrumentation.ts). Idempotent — only touches
 * mappings where localId is missing. Extracted from the manual
 * migrateAccountMappingsToIds admin mutation in sync.ts.
 */

import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { accountDisplayName } from "@/lib/utils/format";
import { log } from "@/lib/logger";
import type { db as appDb } from "./index";
import type { AccountMapping } from "./schema";

type Db = typeof appDb;

export async function backfillMappingLocalIds(db: Db) {
  const connections = await db.select().from(schema.apiConnections);

  let totalMigrated = 0;
  let totalUnresolved = 0;

  for (const conn of connections) {
    const mappings = (conn.accountMappings ?? []) as AccountMapping[];
    if (mappings.length === 0) continue;

    // Check if any mappings need migration
    const needsMigration = mappings.some((m) => !m.localId);
    if (!needsMigration) continue;

    // Load reference data
    const [allAssets, perfAccounts, allPeople, latestSnapshot] =
      await Promise.all([
        db.select().from(schema.otherAssetItems),
        db.select().from(schema.performanceAccounts),
        db.select().from(schema.people),
        db
          .select()
          .from(schema.portfolioSnapshots)
          .orderBy(sql`snapshot_date DESC`)
          .limit(1),
      ]);

    // Build label→perfId map
    const labelToPerfId = new Map<string, number>();
    for (const perf of perfAccounts) {
      if (perf.accountLabel && !labelToPerfId.has(perf.accountLabel)) {
        labelToPerfId.set(perf.accountLabel, perf.id);
      }
      if (perf.displayName && !labelToPerfId.has(perf.displayName)) {
        labelToPerfId.set(perf.displayName, perf.id);
      }
    }

    // Also build labels from latest snapshot
    if (latestSnapshot[0]) {
      const snapAccts = await db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, latestSnapshot[0].id));
      const peopleMap = new Map(allPeople.map((p) => [p.id, p.name]));
      const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

      for (const acct of snapAccts) {
        if (!acct.performanceAccountId) continue;
        const perf = perfMap.get(acct.performanceAccountId);
        const ownerName = acct.ownerPersonId
          ? peopleMap.get(acct.ownerPersonId)
          : undefined;
        const label = accountDisplayName(
          {
            accountType: acct.accountType,
            subType: acct.subType,
            label: acct.label,
            institution: acct.institution,
            displayName: perf?.displayName,
            accountLabel: perf?.accountLabel,
          },
          ownerName ?? undefined,
        );
        if (!labelToPerfId.has(label)) {
          labelToPerfId.set(label, acct.performanceAccountId);
        }
      }
    }

    let changed = false;
    const updated: AccountMapping[] = [...mappings];

    for (let i = 0; i < updated.length; i++) {
      const m = updated[i]!;
      if (m.localId) continue;

      // Mortgage pattern: localName = "mortgage:{id}:{type}"
      if (m.localName.match(/^mortgage:\d+:\w+$/)) {
        const parts = m.localName.split(":");
        updated[i] = {
          ...m,
          localId: m.localName,
          loanId: Number(parts[1]),
          loanMapType: parts[2] as "propertyValue" | "loanBalance",
        };
        changed = true;
        totalMigrated++;
        continue;
      }

      // Asset: match by name
      const assetMatch = allAssets.find((a) => a.name === m.localName);
      if (assetMatch) {
        updated[i] = {
          ...m,
          localId: `asset:${assetMatch.id}`,
          assetId: assetMatch.id,
        };
        changed = true;
        totalMigrated++;
        continue;
      }

      // Portfolio: reverse-map label to performanceAccountId
      const perfId = labelToPerfId.get(m.localName);
      if (perfId) {
        updated[i] = {
          ...m,
          localId: `performance:${perfId}`,
          performanceAccountId: perfId,
        };
        changed = true;
        totalMigrated++;
        continue;
      }

      totalUnresolved++;
      log("warn", "backfill_local_ids_unmatched", {
        service: conn.service,
        localName: m.localName,
      });
    }

    if (changed) {
      await db
        .update(schema.apiConnections)
        .set({ accountMappings: updated })
        .where(eq(schema.apiConnections.service, conn.service));
    }
  }

  if (totalMigrated > 0 || totalUnresolved > 0) {
    log("info", "backfill_local_ids", {
      migrated: totalMigrated,
      unresolved: totalUnresolved,
    });
  }
}
