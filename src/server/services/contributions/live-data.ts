import * as schema from "@/lib/db/schema";
import {
  type AccountCategory,
  getParentCategory,
} from "@/lib/config/account-types";
import { filterActiveJobs } from "@/lib/pure/household/profiles";
import {
  loadEffectiveSalaryProfile,
  mergeSalaryProfileJobFields,
  resolveCompensation,
  contributionPay,
  getTotalCompensation,
} from "@/server/helpers/salary";
import type { Db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Contribution profile resolution
// ---------------------------------------------------------------------------

/**
 * Row shape returned by loadLiveContribData for aggregation. No
 * contributionMethod/contributionValue here — those are never carried by
 * the account row itself (see applyContribActiveFields); resolveProfile
 * adds them from a specific profile's active fields, and only for accounts
 * that have an entry there.
 */
/** A live contribution account row: the full row (so every consumer — the
 *  cap's HSA coverage, payroll vs. manual, ownership, the match's tax
 *  treatment — reads the real fact), with its type narrowed and its parent
 *  category resolved. */
type LiveContribRow = Omit<
  typeof schema.contributionAccounts.$inferSelect,
  "accountType" | "parentCategory"
> & {
  accountType: AccountCategory;
  parentCategory: string;
};

/**
 * Load all live contribution data needed for profile resolution.
 * Intentionally live/unmodified — this is the baseline every named
 * Contribution Profile's active fields get layered ON TOP OF (see
 * resolveProfile's callers), so it can't itself reflect a Plan's active
 * salary without corrupting that layering. See applyActiveSalary's docblock
 * (./salary.ts) for the live-vs-active rule.
 *
 * A job has no salary/bonus of its own — the globally-ACTIVE Salary
 * Profile is the only live source (see resolveCompensation's docblock).
 * Resolving against it here (rather than "no profile at all") is what lets
 * a Contribution Profile's percent-of-salary math have a real number to
 * work from; Contribution and Salary Profiles remain independent axes —
 * this always uses whichever Salary Profile is globally active, never a
 * specific one a caller picked.
 */
export async function loadLiveContribData(db: Db) {
  const [allJobs, allContribs, allPeople, allPerfAccounts] = await Promise.all([
    db.select().from(schema.jobs),
    db.select().from(schema.contributionAccounts),
    db.select().from(schema.people),
    db.select().from(schema.performanceAccounts),
  ]);
  const activeJobsRaw = filterActiveJobs(allJobs, new Date());
  const activeContribs = allContribs.filter((c) => c.isActive);
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
  const contribs: LiveContribRow[] = activeContribs.map((c) => ({
    ...c,
    accountType: c.accountType as AccountCategory,
    parentCategory:
      c.parentCategory ?? getParentCategory(c.accountType as AccountCategory),
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
    rawContribRows: allContribs, // All accounts (active + inactive/stubbed) for profile editor
    peopleMap,
    perfAccountMap,
    salaryProfileActiveMap,
  };
}
