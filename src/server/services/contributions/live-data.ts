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

/** A live contribution account row, as loadLiveContribData returns it: the
 *  full row (so every consumer — the cap's HSA coverage, payroll vs. manual,
 *  ownership, the match's tax treatment — reads the real fact), with its type
 *  narrowed and its parent category resolved. It carries no
 *  contributionMethod/contributionValue (see applyContribActiveFields):
 *  resolveProfile adds them from a profile's active fields. */
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
export async function loadLiveContribData(db: Db, asOf: Date) {
  const [allJobs, allContribs, allPeople, allPerfAccounts] = await Promise.all([
    db.select().from(schema.jobs),
    db.select().from(schema.contributionAccounts),
    db.select().from(schema.people),
    db.select().from(schema.performanceAccounts),
  ]);
  const activeJobsRaw = filterActiveJobs(allJobs, asOf);
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
