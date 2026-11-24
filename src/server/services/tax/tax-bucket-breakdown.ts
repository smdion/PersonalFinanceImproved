/** Tax Buckets' "now" view: the breakdown, each account's early access, and
 *  the snapshot rows left out for an unknown account type. */
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { calendarYear } from "@/lib/utils/date";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";
import {
  unknownTypeNote,
  unknownTypeRows,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";
import { earlyAccessInputs } from "@/server/services/tax/early-access-inputs";

/** Real current-state tax-bucket breakdown from the latest snapshot, with
 *  Rule of 55 / Roth-basis-driven penalty-free/tax-free flags per account. */
export async function taxBucketBreakdown(db: DbOrTx, asOf: Date) {
  const [people, perfAccounts, snapshotData, rothBasisRows, contributionLinks] =
    await Promise.all([
      db.select().from(schema.people),
      db.select().from(schema.performanceAccounts),
      getLatestSnapshot(db),
      db.select().from(schema.accountBasis),
      db
        .select({
          performanceAccountId:
            schema.contributionAccounts.performanceAccountId,
          jobId: schema.contributionAccounts.jobId,
        })
        .from(schema.contributionAccounts),
    ]);

  const jobs = await db.select().from(schema.jobs);

  const breakdown = computeTaxBucketBreakdown(
    snapshotData,
    people.map((p) => ({ id: p.id, name: p.name })),
    perfAccounts.map((p) => ({
      id: p.id,
      isActive: p.isActive,
      accountType: p.accountType,
      costBasis: p.costBasis,
    })),
  );

  const analysis = computeTaxBucketAnalysis({
    breakdown,
    ...earlyAccessInputs({
      jobs,
      jobLinkRows: contributionLinks,
      accountBasisRows: rothBasisRows,
      perfAccounts,
    }),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
    })),
    currentDate: asOf,
  });

  return {
    portfolioByTaxType: breakdown.portfolioByTaxType,
    accounts: analysis,
    // Left out of both views, each noted as the projection notes it.
    unknownTypeNotes: unknownTypeRows(snapshotData?.accounts ?? [], people).map(
      unknownTypeNote,
    ),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
    })),
  };
}
