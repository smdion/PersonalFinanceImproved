/** A resolved contribution profile as the engine reads it. */

import { safeDivide, roundToCents, sumBy } from "@/lib/utils/math";
import type {
  ContributionSpec,
  RetirementContribSlice,
} from "@/lib/pure/engine/types";
import {
  type AccountCategory,
  getAllCategories,
} from "@/lib/config/account-types";
import { portfolioTaxTypeOf } from "@/lib/config/tax-treatment-buckets";
import { type CapPassed, computeValue } from "./contribution-caps";
import { fractionFromPercent } from "./contribution-amount";
import { toNumber } from "@/lib/utils/numbers";
import {
  jobPayFor,
  annualContributionWithBonus,
  resolveContribPeriods,
  type ContribRow,
} from "./contribution-rows";
import { aggregateContributionsByCategory } from "./category-totals";
import { matchAccountForContribution } from "./account-match";

/** Context needed from the main buildEnginePayload for spec building. */
type ProfileContribContext = {
  perfCategoryMap: Map<number, string>;
  perfRetirementBehaviorMap: Map<number, string>;
  perfContributionScalingMap: Map<number, string>;
  personNameById: Map<number, string>;
  accountBreakdownByCategory: Record<
    string,
    {
      name: string;
      taxType: string;
      accountType?: string;
      ownerName?: string;
      parentCategory?: string;
    }[]
  >;
};

/** Result of building engine contribution data from a resolved profile. */
type ProfileContribData = {
  contributionSpecs: ContributionSpec[];
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchRateByCategory: Record<AccountCategory, number>;
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  /** Base-year amounts and match rates over retirement money only. */
  retirementOnly: RetirementContribSlice;
  salaryByPerson: Record<number, number>;
  combinedSalary: number;
  /** Ids of `fixed_per_period` accounts with no resolvable job/pay period —
   *  excluded from contributionSpecs and the category totals. */
  incompleteAccountIds: number[];
};

/** Minimal contribution row shape needed by buildProfileContribData. */
type ContribInputRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label?: string | null;
  parentCategory?: string | null;
  contributionMethod: string | null;
  contributionValue: string | number | null;
  taxTreatment: string | null;
  employerMatchType: string | null;
  employerMatchValue: string | number | null;
  employerMatchRate?: string | number | null;
  employerMaxMatchPct: string | number | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
  performanceAccountId?: number | null;
  targetAnnual?: string | number | null;
  allocationPriority?: number | null;
  ownership?: string | null;
  hsaCoverageType?: string | null;
  /** Set by the IRS-limit cap pass; calculations read computeValue(c). */
  cappedValue?: number;
};

/**
 * Build engine contribution data (specs, employer match, base-year amounts)
 * from a resolved contribution profile.
 *
 * This is the same logic that buildEnginePayload() uses inline for the default
 * profile, extracted so it can be called for each profile-switch year.
 */
export function buildProfileContribData(
  activeContribs: (ContribInputRow & CapPassed)[],
  activeJobs: { id: number; personId: number; payPeriod: string | undefined }[],
  jobSalaries: {
    job: { id: number; personId: number };
    salary: number;
    bonusGross?: number;
    totalComp: number;
  }[],
  ctx: ProfileContribContext,
): ProfileContribData {
  // salary: base; bonusGross: the bonus (an account takes its share when
  // fromBonus); totalComp: always with the bonus, for the rates.
  const totalCompensation = jobSalaries.reduce(
    (sum, js) => sum + js.totalComp,
    0,
  );

  // Aggregate contributions and employer match by category
  const contribRows: (ContribRow & CapPassed)[] = activeContribs.map((c) => ({
    id: c.id,
    personId: c.personId,
    jobId: c.jobId,
    accountType: c.accountType,
    subType: c.subType,
    label: c.label ?? null,
    parentCategory: c.parentCategory ?? "",
    contributionMethod: c.contributionMethod ?? "percent_of_salary",
    contributionValue: String(c.contributionValue ?? "0"),
    cappedValue: c.cappedValue,
    capPassed: c.capPassed,
    taxTreatment: c.taxTreatment ?? "pre_tax",
    employerMatchType: c.employerMatchType,
    employerMatchValue: c.employerMatchValue
      ? String(c.employerMatchValue)
      : null,
    employerMatchRate: c.employerMatchRate,
    employerMaxMatchPct: c.employerMaxMatchPct
      ? String(c.employerMaxMatchPct)
      : null,
    isPayrollDeducted: c.isPayrollDeducted,
    fromBonus: c.fromBonus,
  }));

  const {
    contribByCategory,
    employerMatchByCategory,
    employerMatchById,
    employerMatchByParentCat,
    retirementOnly,
    incompleteAccountIds: aggregationIncompleteIds,
  } = aggregateContributionsByCategory(
    contribRows,
    activeJobs,
    jobSalaries.map((js) => ({
      job: { id: js.job.id, personId: js.job.personId },
      salary: js.salary,
      bonusGross: js.bonusGross,
    })),
  );

  // Employer match rates (fraction of total compensation)
  const matchRates = (match: Record<AccountCategory, number>) =>
    Object.fromEntries(
      getAllCategories().map((cat) => [
        cat,
        totalCompensation > 0 ? match[cat] / totalCompensation : 0,
      ]),
    ) as Record<AccountCategory, number>;
  const employerMatchRateByCategory = matchRates(employerMatchByCategory);

  // Build per-account contribution specs. A `fixed_per_period` account with
  // no resolvable job/pay period can't produce a real spec (periodsPerYear
  // would be a guess) — it's dropped and reported via
  // specBuilderIncompleteIds instead, per the method-gated incomplete
  // treatment (see resolveContribPeriods).
  const specBuilderIncompleteIds: number[] = [];
  const contributionSpecs: ContributionSpec[] = activeContribs
    .filter((c) => {
      const cv = toNumber(String(c.contributionValue ?? "0"));
      return cv > 0;
    })
    .map((c): ContributionSpec | null => {
      const cat = c.accountType;
      const cv = computeValue(c);
      const method = (c.contributionMethod ??
        "percent_of_salary") as ContributionSpec["method"];
      let value: number;
      let baseAnnual: number;
      let periodsPerYear: number | undefined;

      let salaryFraction = 1;
      const js = jobPayFor(c, jobSalaries);
      let personPayShare: number | undefined;
      if (method === "percent_of_salary") {
        value = fractionFromPercent(cv);
        // The pay this rate applies to — base salary, plus the bonus when
        // its check carries this contribution (annualContributionWithBonus)
        // — as a share of total pay, so it grows with salary in the engine.
        const pay = js
          ? safeDivide(annualContributionWithBonus(c, js, 1), value, js.salary)
          : 0;
        baseAnnual = roundToCents(pay * value);
        salaryFraction = safeDivide(pay, totalCompensation, 1);
        // The same pay as a share of this person's total pay — what the
        // engine re-applies each year when it tracks salary per person.
        const personTotal = sumBy(
          jobSalaries.filter((x) => x.job.personId === js?.job.personId),
          (x) => x.totalComp,
        );
        personPayShare = safeDivide(pay, personTotal, 1);
      } else if (method === "fixed_per_period") {
        value = cv;
        const job = activeJobs.find((j) => j.id === c.jobId);
        const resolved = resolveContribPeriods(method, job);
        if (resolved.incomplete) {
          specBuilderIncompleteIds.push(c.id);
          return null;
        }
        periodsPerYear = resolved.periodsPerYear;
        // Includes the bonus check's one extra deduction, when it carries one.
        baseAnnual = roundToCents(
          js
            ? annualContributionWithBonus(c, js, periodsPerYear)
            : cv * periodsPerYear,
        );
      } else {
        // fixed_monthly / fixed_annual — the shared yearly amount (a bonus
        // check carrying contributions takes one more pay period's share).
        value = cv;
        const job = activeJobs.find((j) => j.id === js?.job.id);
        baseAnnual = roundToCents(
          annualContributionWithBonus(
            c,
            js ?? { salary: 0 },
            resolveContribPeriods(method, job).periodsPerYear,
          ),
        );
      }

      // Match contribution to its individual account
      const contribOwner =
        c.personId != null ? ctx.personNameById.get(c.personId) : undefined;
      const matchTaxType =
        portfolioTaxTypeOf(c.taxTreatment ?? "pre_tax") ?? c.taxTreatment;
      const catAccts = ctx.accountBreakdownByCategory[cat] ?? [];
      const contribParentCat =
        c.parentCategory ??
        (c.performanceAccountId
          ? ctx.perfCategoryMap.get(c.performanceAccountId)
          : undefined);
      const matchedAcct = matchAccountForContribution(catAccts, {
        contribOwner,
        matchTaxType,
        accountType: c.accountType,
        contribParentCat,
      });

      return {
        category: cat,
        name: c.subType ?? c.accountType,
        method,
        value,
        salaryFraction,
        ...(personPayShare !== undefined ? { personPayShare } : {}),
        periodsPerYear,
        baseAnnual,
        taxTreatment: (c.taxTreatment ??
          "pre_tax") as ContributionSpec["taxTreatment"],
        personId: c.personId,
        ownerName: contribOwner,
        accountName: matchedAcct?.name,
        targetAnnual: c.targetAnnual ? Number(c.targetAnnual) : null,
        allocationPriority: c.allocationPriority ?? 0,
        parentCategory:
          c.parentCategory ??
          (c.performanceAccountId
            ? ctx.perfCategoryMap.get(c.performanceAccountId)
            : undefined),
        ownership: (c.ownership ?? "individual") as "individual" | "joint",
        retirementBehavior: (c.performanceAccountId
          ? ctx.perfRetirementBehaviorMap.get(c.performanceAccountId)
          : undefined) as ContributionSpec["retirementBehavior"],
        contributionScaling: (c.performanceAccountId
          ? ctx.perfContributionScalingMap.get(c.performanceAccountId)
          : undefined) as ContributionSpec["contributionScaling"],
        hsaCoverageType: c.hsaCoverageType ?? null,
        ...(c.cap && c.cap.overBy > 0
          ? { configuredAnnual: c.cap.annual }
          : {}),
        employerShare: safeDivide(
          employerMatchById.get(c.id) ?? 0,
          employerMatchByCategory[cat],
          0,
        ),
        matchNeedsContribution:
          c.employerMatchType === "percent_of_contribution",
      };
    })
    .filter((spec): spec is ContributionSpec => spec !== null);

  // Base year contributions
  const annuals = (summaries: typeof contribByCategory) =>
    Object.fromEntries(
      getAllCategories().map((cat) => [cat, summaries[cat].annual]),
    ) as Record<AccountCategory, number>;
  const baseYearContributions = annuals(contribByCategory);

  // Per-person salary map (totalComp for display / rate consistency)
  const salaryByPerson: Record<number, number> = {};
  for (const js of jobSalaries) {
    salaryByPerson[js.job.personId] =
      (salaryByPerson[js.job.personId] ?? 0) + js.totalComp;
  }

  return {
    contributionSpecs,
    baseYearContributions,
    baseYearEmployerMatch: employerMatchByCategory,
    employerMatchRateByCategory,
    employerMatchByParentCat,
    retirementOnly: {
      baseYearContributions: annuals(retirementOnly.contribByCategory),
      baseYearEmployerMatch: retirementOnly.employerMatchByCategory,
      employerMatchRateByCategory: matchRates(
        retirementOnly.employerMatchByCategory,
      ),
    },
    salaryByPerson,
    combinedSalary: totalCompensation,
    incompleteAccountIds: Array.from(
      new Set([...aggregationIncompleteIds, ...specBuilderIncompleteIds]),
    ),
  };
}
