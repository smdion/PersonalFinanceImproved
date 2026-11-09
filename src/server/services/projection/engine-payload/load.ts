/**
 * The engine payload's reads: every table in one batch, and the profiles
 * applied to them.
 */
import { eq, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import { getAllPeople } from "@/server/data/people";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { loadSimulationPreset } from "@/server/services/simulation/simulation-preset";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { applySalaryProfileRow } from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import {
  applyContribProfileRow,
  loadAndApplyContribProfile,
} from "@/server/services/contributions/profile";

/** Every DB table the projection and the Simulation read, by name. */
export async function fetchRetirementData(
  db: Db,
  opts?: {
    snapshotId?: number;
    contributionProfileId?: number;
    salaryProfileId?: number;
  },
) {
  const reads = {
    people: getAllPeople(db),
    allJobs: db.select().from(schema.jobs),
    retSettings: db.select().from(schema.retirementSettings),
    retProfiles: db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
    retProfilePeople: db.select().from(schema.retirementProfilePeople),
    retScenarios: db.select().from(schema.retirementScenarios),
    returnRates: db
      .select()
      .from(schema.returnRateTable)
      .orderBy(asc(schema.returnRateTable.age)),
    allContribsRaw: db
      .select()
      .from(schema.contributionAccounts)
      .where(eq(schema.contributionAccounts.isActive, true)),
    // Unfiltered: resolveTaxParams picks the year, anchoring every slice
    // on one year.
    allLimits: db.select().from(schema.contributionLimits),
    snapshotData: getLatestSnapshot(db, opts?.snapshotId),
    salaryOverrideRows: db
      .select()
      .from(schema.retirementSalaryOverrides)
      .orderBy(asc(schema.retirementSalaryOverrides.projectionYear)),
    budgetOverrideRows: db
      .select()
      .from(schema.retirementBudgetOverrides)
      .orderBy(asc(schema.retirementBudgetOverrides.projectionYear)),
    allBudgetProfiles: db
      .select()
      .from(schema.budgetProfiles)
      .orderBy(asc(schema.budgetProfiles.id)),
    allBudgetItems: db.select().from(schema.budgetItems),
    perfAccounts: db.select().from(schema.performanceAccounts),
    allTaxBrackets: db.select().from(schema.taxBrackets),
    allLtcgBrackets: db.select().from(schema.ltcgBrackets),
    allIrmaaBrackets: db.select().from(schema.irmaaBrackets),
    allFplByHousehold: db.select().from(schema.fplByHousehold),
    allTaxParams: db.select().from(schema.taxParams),
    brokerageGoalRows: db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(asc(schema.brokerageGoals.targetYear)),
    allAppSettings: db.select().from(schema.appSettings),
    // The contribution profile's row (null = not found) when its id is known
    // here; undefined when absent, and buildEnginePayload loads it itself.
    contribProfileRow: opts?.contributionProfileId
      ? db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, opts.contributionProfileId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(undefined as undefined),
    // Same batching for the independent Salary Profile axis.
    salaryProfileRow: opts?.salaryProfileId
      ? db
          .select()
          .from(schema.salaryProfiles)
          .where(eq(schema.salaryProfiles.id, opts.salaryProfileId))
          .then(([row]) => (row ? checkSalaryEntries(row) : null))
      : Promise.resolve(undefined as undefined),
    // Which job funds which performance account (withdrawal eligibility).
    // No isActive filter: a separated employer's inactive link is the
    // evidence Rule of 55 needs (the same query as tax-buckets.ts's).
    jobLinkRows: db
      .select({
        performanceAccountId: schema.contributionAccounts.performanceAccountId,
        jobId: schema.contributionAccounts.jobId,
      })
      .from(schema.contributionAccounts),
    accountBasisRows: db.select().from(schema.accountBasis),
    // The Default preset's glide path and stock classes, for VPW's stock
    // share; a Simulation run replaces this with its own preset's.
    defaultPreset: loadSimulationPreset(db, DEFAULT_SIMULATION.preset),
    classBucketRows: db.select().from(schema.assetClassBuckets),
  };
  // Every read starts now, together; each is awaited by its name.
  const settled = await Promise.all(
    Object.entries(reads).map(async ([name, read]) => [name, await read]),
  );
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- each entry holds its own read's result, under its own name
  return Object.fromEntries(settled) as {
    [K in keyof typeof reads]: Awaited<(typeof reads)[K]>;
  };
}

/**
 * Applies the Salary Profile, then the Contribution Profile (its jobs carry
 * their pay-schedule/W-4 fields from the Salary Profile), to every active
 * contribution account, read from `data` when the caller fetched the row.
 */
export async function applyProfiles(
  db: Db,
  data: Awaited<ReturnType<typeof fetchRetirementData>>,
  opts: { contributionProfileId?: number; salaryProfileId?: number },
  allContribsRaw: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allContribsRaw"],
  allJobs: Awaited<ReturnType<typeof fetchRetirementData>>["allJobs"],
) {
  const salaryProfileActiveMap =
    data.salaryProfileRow !== undefined
      ? applySalaryProfileRow(data.salaryProfileRow)
      : await loadEffectiveSalaryProfile(db, opts.salaryProfileId);

  const contribProfileResult =
    data.contribProfileRow !== undefined
      ? applyContribProfileRow(
          data.contribProfileRow,
          allContribsRaw,
          allJobs,
          salaryProfileActiveMap,
        )
      : await loadAndApplyContribProfile(
          db,
          opts.contributionProfileId,
          allContribsRaw,
          allJobs,
          salaryProfileActiveMap,
        );
  const allContribs = contribProfileResult.contribs;
  const patchedJobs = contribProfileResult.jobs;

  return { salaryProfileActiveMap, allContribs, patchedJobs };
}
