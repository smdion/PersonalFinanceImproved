import {
  capForRequest,
  loadCapHousehold,
} from "@/server/services/contributions/caps";
import { getAllPeople } from "@/server/data/people";
import { computeValue } from "@/lib/pure/contributions/contribution-caps";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ProfilePair } from "@/server/services/profile-selection";
import {
  type ContribResolutionStatus,
  filterActiveJobs,
} from "@/lib/pure/household/profiles";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import {
  type SalaryOverrideEntry,
  type SalaryActiveMap,
  applySandboxSalaryEntries,
  resolveCompensation,
  applyActiveSalary,
} from "@/server/helpers/salary";
import {
  loadAndApplyContribProfile,
  applyContribActiveFields,
} from "@/server/services/contributions/profile";
import { classifyContribResolution } from "@/lib/pure/contributions/profile-fields";
import {
  resolveJoblessPeriodsPerYear,
  resolveContribPeriods,
} from "@/lib/pure/contributions/contribution-rows";
import type { Db } from "@/lib/db";
import { computeAnnualContribution } from "@/lib/pure/contributions/contribution-amount";

/**
 * Resolve every linked budget item's per-column dollar amounts through the
 * SAME contribution-account resolution `budget.computeActiveSummary` uses,
 * instead of the item's raw `amounts` column (which is intentionally left
 * stale for linked items — see budget.ts router's `updateItemAmount`/
 * `updateItemAmounts`). Any caller that sums `budget_items.amounts` directly
 * for a profile with contribution-linked items (retirement/projection engine
 * inputs, net-worth year-end snapshots) silently undercounts every linked
 * item, since its raw amount is never written past its `0` template value.
 *
 * `profiles` is the (Contribution, Salary) Profile pair the caller already
 * resolved — this function does no resolution of its own, so a linked
 * item's dollar figure can never disagree between the Budget tab and any
 * other consumer. A budget column is a spending level, not a different pay
 * or contribution world, so a linked item's amount is the same in every
 * column.
 *
 * `opts.sandboxContribActiveFields`/`sandboxSalaryEntries` are the What-If
 * sandbox's own hand-edited values — the highest-precedence tier, layered
 * on top of the Contribution Profile's resolved values exactly the way `budget.computeActiveSummary` needs them to be
 * for its own linked items, so that endpoint can call this helper directly
 * instead of maintaining its own copy of this resolution.
 */
export async function resolveLinkedBudgetItemAmounts<
  T extends {
    id: number;
    contributionAccountId: number | null;
    amounts: unknown;
  },
>(
  db: Db,
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
  const linkedContribIds = new Set(
    items
      .filter((i) => i.contributionAccountId != null)
      .map((i) => i.contributionAccountId!),
  );
  if (linkedContribIds.size === 0) {
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
  const rawContribIds = new Set(rawContribs.map((c) => c.id));
  const allJobs = await db.select().from(schema.jobs);
  const effectiveSalaryMap: SalaryActiveMap = applySandboxSalaryEntries(
    opts?.sandboxSalaryEntries,
    new Map(),
  );

  // The active pair, computed once — every column shows the same figure.
  // (`amounts`/`contribStatus` below repeat it per column for the API shape.)
  const contribMonthlyById = new Map<number, number>();
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
  const activeContribs = capForRequest(
    applyContribActiveFields(
      profileResult.contribs,
      opts?.sandboxContribActiveFields ?? {},
      true,
    ),
    await loadCapHousehold(
      db,
      await getAllPeople(db),
      null,
      new Date().getFullYear(),
    ),
    profileResult.jobs,
    salaryProfileActiveMap,
    effectiveSalaryMap,
  );
  const activeContribIds = new Set(activeContribs.map((c) => c.id));
  const activeJobs = filterActiveJobs(profileResult.jobs, new Date());
  const {
    periodsPerYear: defaultPeriodsPerYear,
    incomplete: joblessIncomplete,
  } = resolveJoblessPeriodsPerYear(activeJobs);

  const salaryByJobId = new Map<number, number>();
  for (const j of activeJobs) {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    // Regular paychecks only (base salary): what a bonus check takes isn't
    // monthly cash flow.
    salaryByJobId.set(
      j.id,
      applyActiveSalary(j.personId, comp.salary, effectiveSalaryMap),
    );
  }

  for (const c of activeContribs) {
    if (!linkedContribIds.has(c.id)) continue;
    const val = computeValue(c);
    const isFixedPerPeriod = c.contributionMethod === "fixed_per_period";
    let jobPeriodsPerYear: number;
    let incomplete: boolean;
    if (c.jobId) {
      const job = activeJobs.find((j) => j.id === c.jobId);
      const resolved = resolveContribPeriods(c.contributionMethod, job);
      jobPeriodsPerYear = resolved.periodsPerYear;
      incomplete = resolved.incomplete;
    } else {
      jobPeriodsPerYear = defaultPeriodsPerYear;
      incomplete = isFixedPerPeriod && joblessIncomplete;
    }
    if (incomplete) {
      incompleteIds.add(c.id);
      contribMonthlyById.set(c.id, 0);
      continue;
    }
    const salary = c.jobId ? (salaryByJobId.get(c.jobId) ?? 0) : 0;
    const annual = computeAnnualContribution(
      c.contributionMethod,
      val,
      salary,
      jobPeriodsPerYear,
    );
    contribMonthlyById.set(c.id, annual / 12);
  }

  const statusById = new Map<number, ContribResolutionStatus>();
  for (const accountId of linkedContribIds) {
    statusById.set(
      accountId,
      classifyContribResolution(
        accountId,
        rawContribIds,
        profileResult.contribActiveFields,
        activeContribIds,
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
      () => contribMonthlyById.get(accountId) ?? 0,
    );
    const contribStatus = Array.from(
      { length: numColumns },
      () => statusById.get(accountId) ?? "ok",
    );
    return { ...i, amounts, contribStatus };
  });
}
