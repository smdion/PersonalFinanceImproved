/** The account rows the early-access analysis reads (Rule of 55, Roth basis). */

import type * as schema from "@/lib/db/schema";
import type { AccountCategory } from "@/lib/config/account-types";
import type { computeTaxBucketAnalysis } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";
import { buildCurrentRothBasisMap } from "@/lib/pure/accounts/roth-basis-rollover";
import { toNumber } from "@/lib/utils/numbers";

type AnalysisInput = Parameters<typeof computeTaxBucketAnalysis>[0];

/**
 * computeTaxBucketAnalysis's account, job-link and Roth-basis inputs, for
 * Tax Buckets and the engine payload alike. Every link counts, inactive
 * ones too: a separated employer's link is Rule of 55's evidence.
 */
export function earlyAccessInputs(rows: {
  jobs: readonly {
    id: number;
    endDate: string | null;
    isSpeculative: boolean;
  }[];
  jobLinkRows: readonly {
    performanceAccountId: number | null;
    jobId: number | null;
  }[];
  accountBasisRows: readonly Pick<
    typeof schema.accountBasis.$inferSelect,
    | "id"
    | "performanceAccountId"
    | "ownerPersonId"
    | "year"
    | "contributionBasis"
    | "conversionBasis"
    | "latestConversionYear"
    | "isFinalized"
    | "isSeeded"
    | "updatedAt"
  >[];
  perfAccounts: readonly Pick<
    typeof schema.performanceAccounts.$inferSelect,
    | "id"
    | "accountType"
    | "ownerPersonId"
    | "isActive"
    | "separationDate"
    | "costBasis"
    | "accountLabel"
    | "displayName"
    | "institution"
  >[];
}): Pick<AnalysisInput, "performanceAccounts" | "jobLinks" | "rothBasisRows"> {
  const jobsById = new Map(rows.jobs.map((j) => [j.id, j]));
  const jobLinks = rows.jobLinkRows
    .filter(
      (l): l is { performanceAccountId: number; jobId: number } =>
        l.performanceAccountId != null && l.jobId != null,
    )
    .map((l) => {
      const job = jobsById.get(l.jobId);
      return {
        performanceAccountId: l.performanceAccountId,
        endDate: job?.endDate ? new Date(job.endDate) : null,
        isSpeculative: job?.isSpeculative ?? false,
      };
    });
  // Each (account, owner) pair's current row: its latest non-finalized
  // year, else its latest finalized one; never one global latest year.
  const currentRothBasisRows = Array.from(
    buildCurrentRothBasisMap(
      rows.accountBasisRows.map((r) => ({
        id: r.id,
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: toNumber(r.contributionBasis),
        conversionBasis: toNumber(r.conversionBasis),
        latestConversionYear: r.latestConversionYear,
        isFinalized: r.isFinalized,
      })),
    ).values(),
  );
  const basisById = new Map(rows.accountBasisRows.map((r) => [r.id, r]));
  return {
    performanceAccounts: rows.perfAccounts.map((p) => ({
      id: p.id,
      accountType: p.accountType as AccountCategory,
      ownerPersonId: p.ownerPersonId,
      isActive: p.isActive,
      separationDate: p.separationDate ? new Date(p.separationDate) : null,
      costBasis: toNumber(p.costBasis),
      accountLabel: p.accountLabel,
      displayName: p.displayName,
      institution: p.institution,
    })),
    jobLinks,
    rothBasisRows: currentRothBasisRows.map((r) => {
      const raw = basisById.get(r.id)!;
      return {
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: r.contributionBasis,
        conversionBasis: r.conversionBasis,
        latestConversionYear: r.latestConversionYear,
        isSeeded: raw.isSeeded,
        updatedAt: raw.updatedAt,
      };
    }),
  };
}
