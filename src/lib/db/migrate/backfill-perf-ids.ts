/**
 * Startup backfill (idempotent): links contribution accounts saved without a
 * performanceAccountId by a fuzzy match on person and account type.
 */

import { eq, isNull } from "drizzle-orm";
import * as schema from "../schema";
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
  const nullContributions = await db
    .select()
    .from(schema.contributionAccounts)
    .where(isNull(schema.contributionAccounts.performanceAccountId));

  if (nullContributions.length > 0) {
    const people = await db.select().from(schema.people);
    const peopleMap = new Map(people.map((p) => [p.id, p]));

    for (const contribution of nullContributions) {
      const person =
        contribution.personId != null
          ? peopleMap.get(contribution.personId)
          : undefined;
      const personName = person?.name.toLowerCase() ?? "";
      const display = getDisplayConfig(
        contribution.accountType,
        contribution.subType,
      );
      const typeLabel = display.displayLabel.toLowerCase();

      const match = perfAccounts.find((pa) => {
        const labelLower = pa.accountLabel.toLowerCase();
        return (
          labelLower.includes(typeLabel) &&
          (pa.ownerPersonId === contribution.personId ||
            // An empty personName (joint or unresolved) would match any label.
            (personName !== "" && labelLower.includes(personName)))
        );
      });

      if (match) {
        await db
          .update(schema.contributionAccounts)
          .set({ performanceAccountId: match.id })
          .where(eq(schema.contributionAccounts.id, contribution.id));
        results.matched++;
      } else {
        results.unmatched++;
        log("warn", "backfill_perf_ids_unmatched", {
          table: "contribution_accounts",
          id: contribution.id,
          accountType: contribution.accountType,
          person: person?.name ?? String(contribution.personId),
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
