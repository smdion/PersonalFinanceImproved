import * as schema from "@/lib/db/schema";
import { type AccountCategory } from "@/lib/config/account-types";
import { filterActiveJobs } from "@/lib/pure/household/profiles";
import {
  mergeSalaryProfileJobFields,
  resolveCompensation,
  contributionPay,
  getTotalCompensation,
} from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import type { Db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Contribution profile resolution
// ---------------------------------------------------------------------------

/** A live contribution account row: the full row with its type narrowed and parent
 *  category resolved, but no contributionMethod/contributionValue (resolveProfile adds
 *  them from a profile's active fields). */
type LiveContributionRow = Omit<
  typeof schema.contributionAccounts.$inferSelect,
  "accountType" | "parentCategory"
> & {
  accountType: AccountCategory;
  parentCategory: string;
};

/**
 * Live contribution data for profile resolution: the base profiles layer onto, so it
 * never reflects a Plan's salary (see applyActiveSalary). Salaries come from the globally
 * active Salary Profile, never a caller-picked one.
 */
export async function loadLiveContribData(db: Db, asOf: Date) {
  const [allJobs, allContributions, allPeople, allPerfAccounts] =
    await Promise.all([
      db.select().from(schema.jobs),
      db.select().from(schema.contributionAccounts),
      db.select().from(schema.people),
      db.select().from(schema.performanceAccounts),
    ]);
  const activeJobsRaw = filterActiveJobs(allJobs, asOf);
  const activeContributions = allContributions.filter((c) => c.isActive);
  const perfAccountMap = new Map(allPerfAccounts.map((pa) => [pa.id, pa]));

  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    activeJobsRaw,
    salaryProfileActiveMap,
  );

  const jobSalaries = activeJobs.map((j) => {
    const comp = resolveCompensation(salaryProfileActiveMap, j.id);
    return {
      job: { id: j.id },
      ...contributionPay(comp.salary, comp.terms),
      baseSalary: comp.salary,
      totalComp: getTotalCompensation(comp.salary, comp.terms),
      personId: j.personId,
    };
  });

  const peopleMap = new Map(allPeople.map((p) => [p.id, p]));

  // Build ContribRow-compatible rows for aggregation (active only for live resolution)
  const contribs: LiveContributionRow[] = activeContributions.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
  }));

  return {
    contribs,
    jobs: activeJobs,
    jobSalaries: jobSalaries.map((js) => ({
      job: { id: js.job.id, personId: js.personId },
      salary: js.salary,
      bonusGross: js.bonusGross,
      baseSalary: js.baseSalary,
      totalComp: js.totalComp,
    })),
    rawContribRows: allContributions, // All accounts (active + inactive/stubbed) for profile editor
    peopleMap,
    perfAccountMap,
    salaryProfileActiveMap,
  };
}
