/**
 * Auto-backfill performanceAccountId on rows that predate the FK column.
 *
 * Runs on startup (via instrumentation.ts). Idempotent — only touches rows
 * where performanceAccountId IS NULL. If it fails, the app still works via
 * the existing fallback matching in performance.ts / snapshot.ts.
 */

import { eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { stripInstitutionSuffix } from "@/lib/utils/format";
import { getDisplayConfig } from "@/lib/config/account-types";
import { log } from "@/lib/logger";
import type { db as appDb } from "./index";

type Db = typeof appDb;

export async function backfillPerformanceAccountIds(db: Db) {
  // Load master registry
  const perfAccounts = await db.select().from(schema.performanceAccounts);
  if (perfAccounts.length === 0) return;

  // Build lookup maps — same logic as buildPerfAcctLookups() in performance.ts
  const byInstLabel = new Map<string, (typeof perfAccounts)[0]>();
  for (const pa of perfAccounts) {
    const labelBase = stripInstitutionSuffix(pa.accountLabel);
    byInstLabel.set(`${pa.institution}:${labelBase}`, pa);
  }

  // Also build a lookup by (institution, accountType, subType, label, ownerPersonId)
  // for portfolio_accounts which don't have accountLabel
  const byFields = new Map<string, (typeof perfAccounts)[0]>();
  for (const pa of perfAccounts) {
    const key = `${pa.institution}:${pa.accountType}:${pa.subType ?? ""}:${pa.label ?? ""}:${pa.ownerPersonId ?? ""}`;
    byFields.set(key, pa);
  }

  const results = {
    accountPerformance: { matched: 0, unmatched: 0 },
    portfolioAccounts: { matched: 0, unmatched: 0 },
    contributionAccounts: { matched: 0, unmatched: 0 },
  };

  // ── account_performance ──
  const nullAcctPerf = await db
    .select({
      id: schema.accountPerformance.id,
      institution: schema.accountPerformance.institution,
      accountLabel: schema.accountPerformance.accountLabel,
    })
    .from(schema.accountPerformance)
    .where(isNull(schema.accountPerformance.performanceAccountId));

  for (const row of nullAcctPerf) {
    const key = `${row.institution}:${row.accountLabel}`;
    const match = byInstLabel.get(key);
    if (match) {
      await db
        .update(schema.accountPerformance)
        .set({ performanceAccountId: match.id })
        .where(eq(schema.accountPerformance.id, row.id));
      results.accountPerformance.matched++;
    } else {
      results.accountPerformance.unmatched++;
      log("warn", "backfill_perf_ids_unmatched", {
        table: "account_performance",
        id: row.id,
        institution: row.institution,
        accountLabel: row.accountLabel,
      });
    }
  }

  // ── portfolio_accounts ──
  const nullPortfolio = await db
    .select({
      id: schema.portfolioAccounts.id,
      institution: schema.portfolioAccounts.institution,
      accountType: schema.portfolioAccounts.accountType,
      subType: schema.portfolioAccounts.subType,
      label: schema.portfolioAccounts.label,
      ownerPersonId: schema.portfolioAccounts.ownerPersonId,
    })
    .from(schema.portfolioAccounts)
    .where(isNull(schema.portfolioAccounts.performanceAccountId));

  for (const row of nullPortfolio) {
    const key = `${row.institution}:${row.accountType}:${row.subType ?? ""}:${row.label ?? ""}:${row.ownerPersonId ?? ""}`;
    const match = byFields.get(key);
    if (match) {
      await db
        .update(schema.portfolioAccounts)
        .set({ performanceAccountId: match.id })
        .where(eq(schema.portfolioAccounts.id, row.id));
      results.portfolioAccounts.matched++;
    } else {
      results.portfolioAccounts.unmatched++;
      log("warn", "backfill_perf_ids_unmatched", {
        table: "portfolio_accounts",
        id: row.id,
        institution: row.institution,
        accountType: row.accountType,
      });
    }
  }

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
      const person = peopleMap.get(contrib.personId);
      const personName = person?.name?.toLowerCase() ?? "";
      const display = getDisplayConfig(contrib.accountType, contrib.subType);
      const typeLabel = display.displayLabel.toLowerCase();

      const match = perfAccounts.find((pa) => {
        const labelLower = (pa.accountLabel ?? "").toLowerCase();
        return (
          labelLower.includes(typeLabel) &&
          (pa.ownerPersonId === contrib.personId ||
            labelLower.includes(personName))
        );
      });

      if (match) {
        await db
          .update(schema.contributionAccounts)
          .set({ performanceAccountId: match.id })
          .where(eq(schema.contributionAccounts.id, contrib.id));
        results.contributionAccounts.matched++;
      } else {
        results.contributionAccounts.unmatched++;
        log("warn", "backfill_perf_ids_unmatched", {
          table: "contribution_accounts",
          id: contrib.id,
          accountType: contrib.accountType,
          person: person?.name ?? String(contrib.personId),
        });
      }
    }
  }

  const total =
    results.accountPerformance.matched +
    results.portfolioAccounts.matched +
    results.contributionAccounts.matched;
  const totalUnmatched =
    results.accountPerformance.unmatched +
    results.portfolioAccounts.unmatched +
    results.contributionAccounts.unmatched;

  if (total > 0 || totalUnmatched > 0) {
    log("info", "backfill_perf_ids", {
      ...results,
      totalMatched: total,
      totalUnmatched,
    });
  }
}
