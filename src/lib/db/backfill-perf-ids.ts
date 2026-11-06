/**
 * Auto-backfill performanceAccountId on contribution accounts saved without
 * one: a fuzzy match by person and account type.
 *
 * Runs on startup (via instrumentation.ts). Idempotent — only touches rows
 * where performanceAccountId IS NULL. Only contribution accounts can be
 * saved without a link.
 */

import { eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { getDisplayConfig } from "@/lib/config/account-types";
import { log } from "@/lib/logger";
import type { Db } from "@/lib/db";

export async function backfillPerformanceAccountIds(db: Db) {
  // Load master registry
  const perfAccounts = await db.select().from(schema.performanceAccounts);
  if (perfAccounts.length === 0) return;

  const results = { matched: 0, unmatched: 0 };

  // ── contribution_accounts ──
  // Fuzzy match by person + type label (same logic as admin.ts backfillPerformanceAccountIds)
  const nullContribs = await db
    .select()
    .from(schema.contributionAccounts)
    .where(isNull(schema.contributionAccounts.performanceAccountId));

  if (nullContribs.length > 0) {
    const people = await db.select().from(schema.people);
    const peopleMap = new Map(people.map((p) => [p.id, p]));

    for (const contrib of nullContribs) {
      const person =
        contrib.personId != null ? peopleMap.get(contrib.personId) : undefined;
      const personName = person?.name?.toLowerCase() ?? "";
      const display = getDisplayConfig(contrib.accountType, contrib.subType);
      const typeLabel = display.displayLabel.toLowerCase();

      const match = perfAccounts.find((pa) => {
        const labelLower = (pa.accountLabel ?? "").toLowerCase();
        return (
          labelLower.includes(typeLabel) &&
          (pa.ownerPersonId === contrib.personId ||
            // Guard against personName being "" (joint contrib / unresolved
            // person) — String.includes("") is always true, which would
            // otherwise match this contrib to ANY performance account of
            // the right type regardless of actual ownership.
            (personName !== "" && labelLower.includes(personName)))
        );
      });

      if (match) {
        await db
          .update(schema.contributionAccounts)
          .set({ performanceAccountId: match.id })
          .where(eq(schema.contributionAccounts.id, contrib.id));
        results.matched++;
      } else {
        results.unmatched++;
        log("warn", "backfill_perf_ids_unmatched", {
          table: "contribution_accounts",
          id: contrib.id,
          accountType: contrib.accountType,
          person: person?.name ?? String(contrib.personId),
        });
      }
    }
  }

  if (results.matched > 0 || results.unmatched > 0) {
    log("info", "backfill_perf_ids", {
      contributionAccounts: results,
      totalMatched: results.matched,
      totalUnmatched: results.unmatched,
    });
  }
}
