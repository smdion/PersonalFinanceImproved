/** Loaders the Performance and basis fills (and the live year-to-date) share. */
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { utcDayOf } from "@/lib/utils/date";
import { mixFor } from "@/lib/pure/flow-suggestions";
import {
  rowsPerAccount,
  suggestPerformanceRow,
} from "@/lib/pure/fill-suggestions";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { loadFillRecord } from "@/server/helpers/fill-ledger";
import { toNumber } from "@/server/helpers/transforms";
import { loadClassifiedTransactions, loadFeedContext } from "./_shared";

type Db = Parameters<typeof loadFeedContext>[0];

/** The year's transactions (voided ones too, so a fill can take them back out). */
export async function loadYearRows(db: Db, year: number) {
  const rows = await loadClassifiedTransactions(db, {
    since: `${year}-01-01`,
    includeVoided: true,
  });
  return rows.filter((r) => r.posted <= `${year}-12-31`);
}

/**
 * The year's (unfinalized) Performance rows with what SimpleFIN has seen
 * since each was last filled — shared by the Performance fill and the
 * "saved this year" pace so both count new money the same way.
 */
export async function loadPerformanceSuggestions(db: Db, year: number) {
  const [perfRows, stamp, coverage, context, mix, ledger, flows] =
    await Promise.all([
      db
        .select()
        .from(schema.accountPerformance)
        .where(
          and(
            eq(schema.accountPerformance.year, year),
            eq(schema.accountPerformance.isActive, true),
            eq(schema.accountPerformance.isFinalized, false),
          ),
        ),
      db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "performance_last_updated")),
      getTransactionCoverageStart(db),
      loadFeedContext(db),
      loadContributionMix(db),
      loadFillRecord(db, "performance", year),
      loadYearRows(db, year),
    ]);
  const perAccount = rowsPerAccount(perfRows);
  const shared = {
    year,
    stamped:
      typeof stamp[0]?.value === "string"
        ? utcDayOf(new Date(stamp[0].value))
        : null,
    feeds: context.feeds,
    subs: context.subs,
    lastTransactionDay: context.lastTransactionDay,
    ledger,
    flows,
    coverageStart: coverage ? utcDayOf(coverage) : null,
    today: utcDayOf(new Date()),
  };
  const accounts = perfRows.map((r) => {
    const rowsOnAccount = perAccount.get(r.performanceAccountId) ?? 1;
    return suggestPerformanceRow(
      {
        id: r.id,
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        totalContributions: toNumber(r.totalContributions),
        employerContributions: toNumber(r.employerContributions),
        distributions: toNumber(r.distributions),
        fees: toNumber(r.fees),
        rollovers: toNumber(r.rollovers),
      },
      {
        ...shared,
        rowsOnAccount,
        // A row tracked per person splits by that person's paycheck; a
        // single row for the account (even one stored under a person)
        // covers everyone's.
        accountMix: mixFor(
          mix,
          r.performanceAccountId,
          rowsOnAccount > 1 ? r.ownerPersonId : null,
        ),
      },
    );
  });
  return accounts;
}
