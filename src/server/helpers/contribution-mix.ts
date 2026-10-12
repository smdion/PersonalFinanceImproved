/**
 * What the paycheck setup sends to each tracked account in a year, split by
 * who pays and how it's taxed. Used to estimate the split of a deposit a
 * feed reports as one amount (see lib/pure/flow-suggestions.ts).
 *
 * Uses the globally active Contribution and Salary Profiles — the setup
 * every page shows unless the household picks another.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isPreTaxTreatment, isTaxFree } from "@/lib/config/account-types";
import type {
  AccountContributionMix,
  ContributionMix,
} from "@/lib/pure/flow-suggestions";
import { filterActiveJobs } from "@/lib/pure/profiles";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { toNumber, type Db } from "./transforms";
import { loadEffectiveSalaryProfile, resolveCompensation } from "./salary";
import {
  computeAnnualContribution,
  computeGroupedEmployerMatch,
  loadAndApplyContribProfile,
  resolveContribPeriods,
} from "./contribution";

export async function loadContributionMix(
  db: Db,
): Promise<Map<number, AccountContributionMix>> {
  const [allJobs, contribs, activeProfile] = await Promise.all([
    db.select().from(schema.jobs),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(eq(schema.contributionAccounts.isActive, true)),
    db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID)),
  ]);
  const profileId = Number(activeProfile[0]?.value ?? NaN);
  const linked = contribs.filter((c) => c.performanceAccountId != null);
  if (linked.length === 0) return new Map();

  const salaryMap = await loadEffectiveSalaryProfile(db, null);
  const { contribs: rows, jobs } = await loadAndApplyContribProfile(
    db,
    Number.isFinite(profileId) ? profileId : null,
    linked,
    filterActiveJobs(allJobs),
    salaryMap,
  );
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const jobByPerson = new Map(jobs.map((j) => [j.personId, j]));

  const resolved = rows.map((c) => {
    const job =
      c.jobId != null
        ? jobById.get(c.jobId)
        : c.personId != null
          ? jobByPerson.get(c.personId)
          : undefined;
    const salary =
      c.jobId != null && job
        ? resolveCompensation(salaryMap, job.id).salary
        : 0;
    const { periodsPerYear } = resolveContribPeriods(
      c.contributionMethod,
      job ? { payPeriod: job.payPeriod ?? undefined } : undefined,
    );
    const annual = computeAnnualContribution(
      c.contributionMethod,
      Number(c.contributionValue),
      salary,
      periodsPerYear,
    );
    return { c, job, salary, annual };
  });

  const match = computeGroupedEmployerMatch(
    resolved.map(({ c, salary, annual }) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual,
      salary,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: c.employerMatchTaxTreatment,
    })),
  );

  const empty = (): ContributionMix => ({
    employeePreTax: 0,
    employeeRoth: 0,
    employeeOther: 0,
    employer: 0,
    employerRoth: 0,
  });
  const add = (
    mix: ContributionMix,
    c: (typeof resolved)[number]["c"],
    annual: number,
  ) => {
    if (isTaxFree(c.taxTreatment)) mix.employeeRoth += annual;
    else if (isPreTaxTreatment(c.taxTreatment)) mix.employeePreTax += annual;
    else mix.employeeOther += annual;
    const m = match.get(c.id);
    mix.employer += m?.matchAnnual ?? 0;
    if (m && isTaxFree(m.employerMatchTaxTreatment))
      mix.employerRoth += m.matchAnnual;
  };
  const out = new Map<number, AccountContributionMix>();
  for (const { c, job, annual } of resolved) {
    const account = out.get(c.performanceAccountId!) ?? {
      ...empty(),
      byPerson: new Map(),
    };
    add(account, c, annual);
    // Whose paycheck it is: the contribution's person, else its job's.
    const person = c.personId ?? job?.personId ?? null;
    if (person !== null) {
      const own = account.byPerson.get(person) ?? empty();
      add(own, c, annual);
      account.byPerson.set(person, own);
    }
    out.set(c.performanceAccountId!, account);
  }
  return out;
}
