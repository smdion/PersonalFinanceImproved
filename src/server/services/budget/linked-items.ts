import { loadCapHousehold } from "@/server/services/contributions/caps";
import { capForRequest } from "@/lib/pure/contributions/cap-pass";
import { getAllPeople } from "@/server/data/people";
import { computeValue } from "@/lib/pure/contributions/contribution-caps";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ProfilePair } from "@/server/services/profile-selection";
import {
  type ContribResolutionStatus,
  filterActiveJobs,
  whatIfForJob,
} from "@/lib/pure/household/profiles";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import {
  type SalaryOverrideEntry,
  type SalaryActiveMap,
  applySandboxSalaryEntries,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import {
  loadAndApplyContribProfile,
  applyContribActiveFields,
} from "@/server/services/contributions/profile";
import { classifyContributionResolution } from "@/lib/pure/contributions/profile-fields";
import { rowPaySchedule } from "@/lib/pure/contributions/contribution-rows";
import type { Db } from "@/lib/db";
import { computeAnnualContribution } from "@/lib/pure/contributions/contribution-amount";

/**
 * Per-column amounts for linked budget items via the contribution-account resolution, not
 * the stale raw `amounts`, under the caller's resolved `profiles` pair (same in every
 * column). `opts` sandbox values (What-If) layer on top. `scope.asOf` picks limits/jobs.
 */
export async function resolveLinkedBudgetItemAmounts<
  T extends {
    id: number;
    contributionAccountId: number | null;
    amounts: unknown;
  },
>(
  { db, scope }: { db: Db; scope: { asOf: Date } },
  items: T[],
  numColumns: number,
  profiles: ProfilePair,
  opts?: {
    sandboxContribActiveFields?: Record<string, { contributionValue: string }>;
    sandboxSalaryEntries?: Record<string, SalaryOverrideEntry> | null;
  },
): Promise<
  (T & { amounts: number[]; contribStatus: ContribResolutionStatus[] | null })[]
> {
  const linkedContributionIds = new Set(
    items
      .filter((i) => i.contributionAccountId != null)
      .map((i) => i.contributionAccountId!),
  );
  if (linkedContributionIds.size === 0) {
    return items.map((i) => ({
      ...i,
      amounts: i.amounts as number[],
      contribStatus: null,
    }));
  }

  const rawContribs = await db
    .select()
    .from(schema.contributionAccounts)
    .where(eq(schema.contributionAccounts.isActive, true));
  const rawContributionIds = new Set(rawContribs.map((c) => c.id));
  const allJobs = await db.select().from(schema.jobs);
  const effectiveSalaryMap: SalaryActiveMap = applySandboxSalaryEntries(
    opts?.sandboxSalaryEntries,
    new Map(),
  );

  // The active pair, computed once — every column shows the same figure.
  // (`amounts`/`contribStatus` below repeat it per column for the API shape.)
  const contributionMonthlyById = new Map<number, number>();
  const incompleteIds = new Set<number>();
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
    db,
    profiles.salaryProfileId,
  );
  const profileResult = await loadAndApplyContribProfile(
    db,
    profiles.contribProfileId,
    rawContribs,
    allJobs,
    salaryProfileActiveMap,
  );
  // The IRS-limit cap pass: these lines show the capped contribution.
  const activeContributions = capForRequest(
    applyContribActiveFields(
      profileResult.contribs,
      opts?.sandboxContribActiveFields ?? {},
      true,
    ),
    await loadCapHousehold(db, await getAllPeople(db), null, scope.asOf),
    profileResult.jobs,
    salaryProfileActiveMap,
    effectiveSalaryMap,
  );
  const activeContributionIds = new Set(activeContributions.map((c) => c.id));
  const activeJobs = filterActiveJobs(profileResult.jobs, scope.asOf);

  const salaryByJobId = new Map<number, number>();
  for (const j of activeJobs) {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    // Regular paychecks only (base salary): a bonus check isn't monthly cash flow.
    // A What-If salary is the current job's only (whatIfForJob).
    const whatIf = whatIfForJob(j, activeJobs, scope.asOf, effectiveSalaryMap);
    salaryByJobId.set(j.id, whatIf?.salary ?? comp.salary);
  }

  for (const c of activeContributions) {
    if (!linkedContributionIds.has(c.id)) continue;
    const val = computeValue(c);
    const { periodsPerYear: jobPeriodsPerYear, incomplete } = rowPaySchedule(
      c,
      activeJobs,
    );
    if (incomplete) {
      incompleteIds.add(c.id);
      contributionMonthlyById.set(c.id, 0);
      continue;
    }
    const salary = c.jobId ? (salaryByJobId.get(c.jobId) ?? 0) : 0;
    const annual = computeAnnualContribution(
      c.contributionMethod,
      val,
      salary,
      jobPeriodsPerYear,
    );
    contributionMonthlyById.set(c.id, annual / 12);
  }

  const statusById = new Map<number, ContribResolutionStatus>();
  for (const accountId of linkedContributionIds) {
    statusById.set(
      accountId,
      classifyContributionResolution(
        accountId,
        rawContributionIds,
        profileResult.contribActiveFields,
        activeContributionIds,
        incompleteIds,
      ),
    );
  }

  return items.map((i) => {
    if (i.contributionAccountId == null) {
      return { ...i, amounts: i.amounts as number[], contribStatus: null };
    }
    const accountId = i.contributionAccountId;
    const amounts = Array.from(
      { length: numColumns },
      () => contributionMonthlyById.get(accountId) ?? 0,
    );
    const contribStatus = Array.from(
      { length: numColumns },
      () => statusById.get(accountId) ?? "ok",
    );
    return { ...i, amounts, contribStatus };
  });
}
