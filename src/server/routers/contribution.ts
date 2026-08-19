/** Contribution router for computing per-account contribution allocations, IRS limits, employer matches, and accumulation order across retirement and brokerage accounts. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateContributions } from "@/lib/calculators/contribution";
import { countPeriodsElapsed } from "@/lib/calculators/paycheck";
import { accountDisplayName, stripInstitutionSuffix } from "@/lib/utils/format";
import {
  toNumber,
  getPeriodsPerYear,
  getEffectiveIncome,
  getTotalCompensation,
  resolveCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  buildContribAccounts,
  computeAnnualContribution,
  computeBonusGross,
  loadAndApplyContribProfile,
  loadEffectiveSalaryProfile,
  applySandboxSalaryEntries,
  applyContribActiveFields,
  buildSandboxContribRow,
} from "@/server/helpers";
import {
  toSalaryActiveMap,
  zSandboxSalaryEntries,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "./_shared";
import { roundToCents, safeDivide } from "@/lib/utils/math";
import { DEFAULT_PAY_PERIODS_PER_YEAR } from "@/lib/constants";
import { getAge, isPriorYearContribWindow } from "@/lib/utils/date";
import {
  resolveIrsLimit,
  resolvePriorYearLimit,
  computeSiblingTotal,
  isEligibleForPriorYear,
  computeViewAwareAccountMetrics,
  computeViewAwareTotals,
} from "@/lib/pure/contributions";
import type {
  AccountViewMetrics,
  ViewAwareTotals,
} from "@/lib/pure/contributions";
import { findActiveJob } from "@/lib/pure/profiles";
import type {
  ContributionInput,
  AccountCategory,
  ViewMode,
} from "@/lib/calculators/types";
import {
  isOverflowTarget,
  getAccountTypeConfig,
  getDisplayConfig,
  getLimitGroup,
  isInLimit401kGroup,
  getDefaultAccumulationOrder,
  categoriesWithIrsLimit,
  isRetirementCategory,
  isTaxFree,
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";

function getAgeFromDob(dob: string, asOf: Date): number {
  return getAge(new Date(dob), asOf);
}

type AccountTypeSnapshot = {
  accountType: string; // display label (e.g. '401k', 'ESPP', 'Long Term Brokerage')
  categoryKey: string; // base config key for color lookup (e.g. 'brokerage' for all brokerage sub-types, 'espp' for ESPP)
  parentCategory: string; // 'Retirement' or 'Portfolio' — from DB parentCategory column
  limit: number;
  employeeContrib: number;
  employerMatch: number;
  totalContrib: number; // employee + employer (toward limit where applicable)
  views: Record<ViewMode, AccountViewMetrics>;
  ytdDataStale: boolean; // true when YTD actual < expected — performance data may be behind
  currentPctOfSalary: number | null; // current employee % of salary (whole number)
  /** True pre-tax (Traditional) contributions only — hsa/afterTax are NOT
   *  folded in here; see afterTaxContrib/hsaContrib below. */
  tradContrib: number;
  taxFreeContrib: number; // Roth
  /** Taxable/brokerage contributions (taxTreatment: "after_tax"). */
  afterTaxContrib: number;
  /** HSA contributions (taxTreatment: "hsa"). Tracked separately from
   *  tradContrib since HSA isn't Traditional/pre-tax retirement money. */
  hsaContrib: number;
  bonusContrib: number; // estimated 401k from bonus
  isJoint: boolean;
  hasDiscountBar: boolean; // config-driven: ESPP-style discount bar rendering
  employerMatchLabel: string; // config-driven: 'match' or 'disc.' etc.
  targetAnnual: number | null; // user's self-imposed annual target (null = no target)
  allocationPriority: number; // overflow routing priority (lower = higher priority)
  priorYear?: {
    amount: number; // total designated for prior tax year across all contribs in this category
    limit: number; // prior year's IRS limit
    remaining: number; // room left in prior year
    contribs: { id: number; amount: number }[]; // per-contrib breakdown for inline editing
  };
};

/** Per-raw-contrib computed data — lets consumers (e.g. Paycheck page) use
 *  pre-computed values instead of re-deriving annual amounts, limits, and siblings. */
type PerContribData = {
  contribId: number;
  annualAmount: number;
  employerMatchAnnual: number;
  limit: number; // resolved IRS limit (with coverage variant + catchup)
  siblingAnnualTotal: number; // sum of annual amounts for other contribs in same limit group
  limitGroup: string | null;
  /** Actual YTD contributions from performance data (null if no performance account linked). */
  ytdActual: { contributions: number; employerMatch: number } | null;
  priorYear?: {
    amount: number; // designated for prior tax year
    limit: number; // prior year's IRS limit
    remaining: number; // room left in prior year
  };
};

type PersonSnapshot = {
  person: { id: number; name: string };
  salary: number;
  /** Total compensation (always includes bonus) — used for savings rate denominator. */
  totalCompensation: number;
  bonusGross: number;
  periodsPerYear: number;
  periodsElapsedYtd: number;
  accountTypes: AccountTypeSnapshot[];
  perContribData: PerContribData[];
  totals: {
    views: Record<ViewMode, ViewAwareTotals>;
    /** Actual YTD retirement contributions from performance data. */
    ytdActualRetirement: number;
    /** Actual YTD portfolio contributions from performance data. */
    ytdActualPortfolio: number;
    /** Actual YTD retirement employer match from performance data. */
    ytdActualRetirementMatch: number;
    /** Actual YTD portfolio employer match from performance data. */
    ytdActualPortfolioMatch: number;
  };
  result: ReturnType<typeof calculateContributions> | null;
};

export const contributionRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(
      z
        .object({
          salaryActiveFields: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
          salaryProfileId: z.number().int().optional(),
          /** See paycheckRouter.computeSummary's identical field — must be
           *  sent to both routers together or the contribution cards and
           *  the pay stub disagree, same bug class as the ContributionsSection
           *  fix this hook already exists to avoid. */
          sandboxSalaryEntries: zSandboxSalaryEntries,
          /** See paycheckRouter.computeSummary's identical field — must be
           *  sent to both routers or the pay stub and the contribution
           *  cards disagree, same bug class as this hook's own fix. */
          sandboxContribActiveFields: zSandboxContribActiveFields,
          /** See paycheckRouter.computeSummary's identical field. */
          sandboxContribAdditions: zSandboxContribAdditions,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const salaryActiveMap = toSalaryActiveMap(input?.salaryActiveFields);
      const currentYear = new Date().getFullYear();
      const inPriorYearWindow = isPriorYearContribWindow();
      const priorYear = currentYear - 1;

      const [
        people,
        allJobs,
        allContribs,
        allLimits,
        priorYearLimitsRaw,
        perfAccounts,
        currentYearPerfActuals,
        perfLastUpdatedRows,
      ] = await Promise.all([
        ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
        ctx.db.select().from(schema.jobs),
        ctx.db
          .select()
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.isActive, true)),
        ctx.db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.taxYear, currentYear)),
        // Fetch prior-year limits only during the IRS window
        inPriorYearWindow
          ? ctx.db
              .select()
              .from(schema.contributionLimits)
              .where(eq(schema.contributionLimits.taxYear, priorYear))
          : Promise.resolve([]),
        ctx.db
          .select({
            id: schema.performanceAccounts.id,
            parentCategory: schema.performanceAccounts.parentCategory,
            accountLabel: schema.performanceAccounts.accountLabel,
            displayName: schema.performanceAccounts.displayName,
          })
          .from(schema.performanceAccounts),
        ctx.db
          .select({
            performanceAccountId:
              schema.accountPerformance.performanceAccountId,
            totalContributions: schema.accountPerformance.totalContributions,
            employerContributions:
              schema.accountPerformance.employerContributions,
          })
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.year, currentYear)),
        ctx.db
          .select({
            key: schema.appSettings.key,
            value: schema.appSettings.value,
          })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, "performance_last_updated")),
      ]);

      const perfLastUpdated = perfLastUpdatedRows[0]?.value
        ? new Date(perfLastUpdatedRows[0].value as string)
        : null;

      // Build YTD actuals lookup: performanceAccountId → { contributions, employerMatch }
      const perfActualMap = new Map<
        number,
        { contributions: number; employerMatch: number }
      >();
      // total_contributions includes employer match — split into employee-only + match
      for (const row of currentYearPerfActuals) {
        if (row.performanceAccountId == null) continue;
        const total = toNumber(row.totalContributions);
        const match = toNumber(row.employerContributions);
        const employeeOnly = total - match;
        const existing = perfActualMap.get(row.performanceAccountId);
        if (existing) {
          existing.contributions += employeeOnly;
          existing.employerMatch += match;
        } else {
          perfActualMap.set(row.performanceAccountId, {
            contributions: employeeOnly,
            employerMatch: match,
          });
        }
      }

      // Build label map for performance accounts — strip institution suffix for category grouping
      // e.g. "Long Term Brokerage (Vanguard)" → "Long Term Brokerage"
      const perfLabelMap = new Map(
        perfAccounts.map((p) => {
          const full = accountDisplayName(p);
          const stripped = stripInstitutionSuffix(full);
          return [p.id, stripped || full];
        }),
      );

      const limitsRecord: Record<string, number> = {};
      for (const l of allLimits) limitsRecord[l.limitType] = toNumber(l.value);

      const priorYearLimitsRecord: Record<string, number> = {};
      for (const l of priorYearLimitsRaw)
        priorYearLimitsRecord[l.limitType] = toNumber(l.value);

      // Two independent axes: Salary Profile fills salary gaps left by the
      // Plan/session overrides already in the map; Contribution Profile
      // overrides account/job fields only. No explicit salaryProfileId
      // falls back to the globally-active profile.
      const effectiveSalaryMap = applySandboxSalaryEntries(
        input?.sandboxSalaryEntries,
        salaryActiveMap,
      );
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        input?.salaryProfileId,
      );
      const profileResult = await loadAndApplyContribProfile(
        ctx.db,
        input?.contributionProfileId,
        allContribs,
        allJobs,
      );
      // Sandbox edits are the highest-precedence tier, applied AFTER the
      // picked profile's own overrides via the SAME merge function.
      const effectiveContribs = applyContribActiveFields(
        profileResult.contribs,
        input?.sandboxContribActiveFields ?? {},
        true,
      );
      for (const [i, addition] of (
        input?.sandboxContribAdditions ?? []
      ).entries()) {
        effectiveContribs.push(buildSandboxContribRow(addition, -(i + 1)));
      }
      const effectiveJobs = profileResult.jobs;

      const asOfDate = new Date();

      // Split YTD actuals proportionally when multiple contribs share a perf
      // account, scaled by each job's elapsed pay-period fraction. Salary is
      // a flat number under the active Salary Profile (no mid-year timeline
      // to walk any more — see resolveCompensation's docblock), so expected
      // YTD is just salary × pct × elapsed fraction.
      const activeContribs = effectiveContribs.filter((c) => c.isActive);

      // Cache resolved salary and period data per job — used for
      // proportional YTD split.
      const jobCache = new Map<
        number,
        {
          salary: number;
          periodsPerYear: number;
          periodsElapsed: number;
        }
      >();
      for (const c of activeContribs) {
        if (c.performanceAccountId == null || !c.jobId) continue;
        if (jobCache.has(c.jobId)) continue;
        const job = effectiveJobs.find((j) => j.id === c.jobId);
        if (!job) continue;
        // Must apply the same Plan/session override tier as the actual-salary
        // computation below, or YTD-vs-actual diverges whenever a What-If
        // salary override is active (expected YTD would keep using the
        // un-overridden Salary Profile value).
        const rawSalary = resolveCompensation(
          salaryProfileActiveMap,
          job.id,
        ).salary;
        const salary = applyActiveSalary(
          job.personId,
          rawSalary,
          effectiveSalaryMap,
        );
        const periodsPerYear = getPeriodsPerYear(job.payPeriod);
        const anchor = job.anchorPayDate ? new Date(job.anchorPayDate) : null;
        const periodsElapsed = anchor
          ? countPeriodsElapsed(asOfDate, job.payPeriod, anchor)
          : Math.round((asOfDate.getMonth() / 12) * periodsPerYear);
        jobCache.set(c.jobId, { salary, periodsPerYear, periodsElapsed });
      }

      // Compute expected YTD for each contrib and group by perf account.
      // expectedYtdMap is also used in the categoryMap loop for data-lag detection.
      const expectedYtdMap = new Map<number, number>();
      const byPerfId = new Map<
        number,
        { contribId: number; expectedYtd: number }[]
      >();
      for (const c of activeContribs) {
        const value = toNumber(String(c.contributionValue));
        let expectedYtd = 0;

        const jd = c.jobId ? jobCache.get(c.jobId) : null;
        if (c.contributionMethod === "percent_of_salary" && jd) {
          const pct = value / 100;
          expectedYtd =
            jd.salary * pct * (jd.periodsElapsed / jd.periodsPerYear);
        } else {
          // Fixed methods: scale by elapsed fraction
          const periodsPerYear =
            jd?.periodsPerYear ?? DEFAULT_PAY_PERIODS_PER_YEAR;
          const periodsElapsed = jd?.periodsElapsed ?? 0;
          const annual = computeAnnualContribution(
            c.contributionMethod,
            value,
            0,
            periodsPerYear,
          );
          expectedYtd = annual * (periodsElapsed / periodsPerYear);
        }

        expectedYtdMap.set(c.id, expectedYtd);

        if (c.performanceAccountId != null) {
          const arr = byPerfId.get(c.performanceAccountId) ?? [];
          arr.push({ contribId: c.id, expectedYtd });
          byPerfId.set(c.performanceAccountId, arr);
        }
      }

      const contribActualMap = new Map<
        number,
        { contributions: number; employerMatch: number }
      >();

      // Split perf account actuals proportionally by expected YTD
      for (const [perfId, entries] of byPerfId) {
        const actual = perfActualMap.get(perfId);
        if (!actual) continue;
        const totalExpected = entries.reduce((s, e) => s + e.expectedYtd, 0);
        for (const entry of entries) {
          const share =
            totalExpected > 0
              ? entry.expectedYtd / totalExpected
              : 1 / entries.length;
          contribActualMap.set(entry.contribId, {
            contributions: roundToCents(actual.contributions * share),
            employerMatch: roundToCents(actual.employerMatch * share),
          });
        }
      }

      const results: PersonSnapshot[] = await Promise.all(
        people.map(async (person) => {
          const activeJob = findActiveJob(effectiveJobs, person.id);
          if (!activeJob) {
            return {
              person,
              salary: 0,
              totalCompensation: 0,
              bonusGross: 0,
              periodsPerYear: DEFAULT_PAY_PERIODS_PER_YEAR,
              periodsElapsedYtd: 0,
              accountTypes: [],
              perContribData: [],
              totals: {
                views: {
                  projected: {
                    retirementWithoutMatch: 0,
                    retirementWithMatch: 0,
                    portfolioWithoutMatch: 0,
                    portfolioWithMatch: 0,
                    totalWithoutMatch: 0,
                    totalWithMatch: 0,
                    savingsRateWithMatch: 0,
                    savingsRateWithoutMatch: 0,
                  },
                  blended: {
                    retirementWithoutMatch: 0,
                    retirementWithMatch: 0,
                    portfolioWithoutMatch: 0,
                    portfolioWithMatch: 0,
                    totalWithoutMatch: 0,
                    totalWithMatch: 0,
                    savingsRateWithMatch: 0,
                    savingsRateWithoutMatch: 0,
                  },
                  ytd: {
                    retirementWithoutMatch: 0,
                    retirementWithMatch: 0,
                    portfolioWithoutMatch: 0,
                    portfolioWithMatch: 0,
                    totalWithoutMatch: 0,
                    totalWithMatch: 0,
                    savingsRateWithMatch: 0,
                    savingsRateWithoutMatch: 0,
                  },
                },
                ytdActualRetirement: 0,
                ytdActualPortfolio: 0,
                ytdActualRetirementMatch: 0,
                ytdActualPortfolioMatch: 0,
              },
              result: null,
            };
          }

          const comp = resolveCompensation(
            salaryProfileActiveMap,
            activeJob.id,
          );
          // The What-If sandbox can override salary and/or bonus terms
          // independently of the Salary Profile's own resolved values.
          const personEntry = effectiveSalaryMap.get(person.id);
          const dbSalary = applyActiveSalary(
            person.id,
            comp.salary,
            effectiveSalaryMap,
          );
          const bonusTerms = applyActiveBonusTerms(personEntry, comp.terms);
          const salary = getEffectiveIncome(activeJob, dbSalary, bonusTerms);
          // Total compensation (always includes bonus) — used for savings rate denominator
          const totalCompensation = getTotalCompensation(dbSalary, bonusTerms);
          const periodsPerYear = getPeriodsPerYear(activeJob.payPeriod);
          const periodsElapsedYtd = activeJob.anchorPayDate
            ? countPeriodsElapsed(
                asOfDate,
                activeJob.payPeriod,
                new Date(activeJob.anchorPayDate),
              )
            : Math.round((asOfDate.getMonth() / 12) * periodsPerYear);
          const age = getAgeFromDob(person.dateOfBirth, asOfDate);

          const jobContribs = effectiveContribs.filter(
            (c) => c.jobId === activeJob.id,
          );
          const personalContribs = effectiveContribs.filter(
            (c) =>
              c.jobId === null &&
              c.personId === person.id &&
              c.ownership !== "joint",
          );

          const accounts = buildContribAccounts(
            jobContribs,
            personalContribs,
            salary,
            periodsPerYear,
          );
          const rawContribs = [...jobContribs, ...personalContribs];

          const input: ContributionInput = {
            annualSalary: salary,
            totalCompensation,
            contributionAccounts: accounts,
            limits: limitsRecord,
            asOfDate,
          };

          const result = calculateContributions(input);

          const bonusGross = computeBonusGross(
            salary,
            bonusTerms.bonusPercent,
            bonusTerms.bonusMultiplier,
            bonusTerms.monthsInBonusYear,
          );

          // Estimate bonus contributions for categories in the 401k limit group (if include401kInBonus is set)
          let bonus401k = 0;
          if (activeJob.include401kInBonus && bonusGross > 0) {
            const bonusPct = rawContribs
              .filter(
                (c) =>
                  isInLimit401kGroup(c.accountType) &&
                  c.contributionMethod === "percent_of_salary",
              )
              .reduce(
                (s, c) => s + toNumber(String(c.contributionValue)) / 100,
                0,
              );
            bonus401k = roundToCents(bonusGross * bonusPct);
          }

          // Resolve IRS limit for an account type (with coverage variant + catchup)
          const resolveContribLimit = (
            accountType: string,
            hsaCoverageType: string | null,
          ): number =>
            resolveIrsLimit(accountType, age, hsaCoverageType, limitsRecord);

          // Resolve prior-year IRS limit for an account type
          const resolveContribPriorYearLimit = (
            accountType: string,
            hsaCoverageType: string | null,
          ): number =>
            resolvePriorYearLimit(
              accountType,
              age,
              hsaCoverageType,
              priorYearLimitsRecord,
            );

          // Build per-raw-contrib computed data for consumers (Paycheck page)
          const perContribData: PerContribData[] = rawContribs.map((rc, i) => {
            const annual = accounts[i]!.annualContribution;
            const matchAnnual = accounts[i]!.employerMatch;
            const group = getLimitGroup(rc.accountType as AccountCategory);
            const limit = resolveContribLimit(
              rc.accountType,
              rc.hsaCoverageType,
            );
            // Sibling total: other contribs in same limit group for this person
            // When matchCountsTowardLimit, include sibling employer matches too (e.g. HSA)
            const cfg = categoriesWithIrsLimit().includes(
              rc.accountType as AccountCategory,
            )
              ? getAccountTypeConfig(rc.accountType as AccountCategory)
              : null;
            const siblingAnnualTotal = group
              ? computeSiblingTotal(
                  rawContribs.map((rc, idx) => ({
                    accountType: rc.accountType,
                    annualContribution: accounts[idx]!.annualContribution,
                    employerMatch: accounts[idx]!.employerMatch,
                  })),
                  i,
                  cfg?.matchCountsTowardLimit ?? false,
                )
              : 0;

            // Prior-year contribution tracking — only use amount if it's tagged for the correct year
            const rawPyAmount = toNumber(rc.priorYearContribAmount);
            const priorYearAmount =
              rc.priorYearContribYear === priorYear ? rawPyAmount : 0;
            let priorYearData: PerContribData["priorYear"];
            if (
              isEligibleForPriorYear(
                inPriorYearWindow,
                rc.accountType,
                priorYearAmount,
              )
            ) {
              const pyLimit = resolveContribPriorYearLimit(
                rc.accountType,
                rc.hsaCoverageType,
              );
              priorYearData = {
                amount: priorYearAmount,
                limit: pyLimit,
                remaining: Math.max(0, pyLimit - priorYearAmount),
              };
            }

            return {
              contribId: rc.id,
              annualAmount: roundToCents(annual),
              employerMatchAnnual: roundToCents(matchAnnual),
              limit,
              siblingAnnualTotal: roundToCents(siblingAnnualTotal),
              limitGroup: group,
              ytdActual: contribActualMap.get(rc.id) ?? null,
              priorYear: priorYearData,
            };
          });

          // Build per-account-type snapshots
          // Group accounts by display category derived from DB columns
          const categoryMap = new Map<
            string,
            {
              employee: number;
              match: number;
              trad: number;
              taxFree: number;
              afterTax: number;
              hsa: number;
              isJoint: boolean;
              parentCategory: string;
              hasDiscountBar: boolean;
              employerMatchLabel: string;
              categoryKey: string;
              targetAnnual: number | null;
              allocationPriority: number;
              priorYearAmount: number;
              priorYearContribs: { id: number; amount: number }[];
              ytdContributions: number;
              ytdEmployerMatch: number;
              blendedEmployee: number;
              blendedMatch: number;
              ytdDataStale: boolean;
            }
          >();

          // Compute method-aware remaining fraction for blended estimates.
          // Each contribution method has a different delivery cadence.
          const monthsElapsed =
            asOfDate.getMonth() + (asOfDate.getDate() >= 15 ? 1 : 0);
          function methodRemainingFraction(method: string): number {
            switch (method) {
              case "fixed_monthly":
                return (12 - monthsElapsed) / 12;
              case "fixed_annual":
                return 0;
              default:
                return periodsPerYear > 0
                  ? (periodsPerYear - periodsElapsedYtd) / periodsPerYear
                  : 1;
            }
          }
          for (let i = 0; i < accounts.length; i++) {
            const acct = accounts[i]!;
            const rawContrib = rawContribs[i]!;
            const linkedPerfLabel = rawContrib.performanceAccountId
              ? perfLabelMap.get(rawContrib.performanceAccountId)
              : null;

            // Resolve display config — checks subTypeDisplay overrides (e.g. ESPP),
            // then falls back to the base accountType config
            const display = getDisplayConfig(
              rawContrib.accountType,
              rawContrib.subType,
            );

            // Display category: use config displayLabel for proper casing (e.g. 'IRA' not 'ira'),
            // then resolve brokerage/overflow to a specific display name
            let cat: string = display.displayLabel;
            if (isOverflowTarget(rawContrib.accountType as AccountCategory)) {
              if (
                display.hasDiscountBar ||
                display.displayLabel.toLowerCase() !==
                  rawContrib.accountType.toLowerCase()
              ) {
                // Sub-type with distinct display (e.g. ESPP) — use config label (not perf account name which includes person)
                cat = display.displayLabel;
              } else if (linkedPerfLabel) {
                cat = linkedPerfLabel;
              } else if (rawContrib.label) {
                cat = `${rawContrib.label} Brokerage`;
              } else {
                cat = isRetirementCategory(
                  rawContrib.accountType as AccountCategory,
                )
                  ? "Retirement Brokerage"
                  : "Long Term Brokerage";
              }
            }

            // Color key: sub-type key (e.g. 'espp') if sub-type display matched, otherwise base accountType
            const categoryKey =
              rawContrib.subType &&
              display.displayLabel.toLowerCase() !==
                rawContrib.accountType.toLowerCase()
                ? rawContrib.subType.toLowerCase()
                : rawContrib.accountType;

            const entry = categoryMap.get(cat) ?? {
              employee: 0,
              match: 0,
              trad: 0,
              taxFree: 0,
              afterTax: 0,
              hsa: 0,
              isJoint: false,
              parentCategory: rawContrib.parentCategory,
              hasDiscountBar: display.hasDiscountBar,
              employerMatchLabel: display.employerMatchLabel,
              categoryKey,
              targetAnnual: rawContrib.targetAnnual
                ? Number(rawContrib.targetAnnual)
                : null,
              allocationPriority: rawContrib.allocationPriority ?? 0,
              priorYearAmount: 0,
              priorYearContribs: [],
              ytdContributions: 0,
              ytdEmployerMatch: 0,
              blendedEmployee: 0,
              blendedMatch: 0,
              ytdDataStale: false,
            };
            // Accumulate YTD actuals from proportionally-split performance data
            const contribActual = contribActualMap.get(rawContrib.id);
            if (contribActual) {
              entry.ytdContributions += contribActual.contributions;
              entry.ytdEmployerMatch += contribActual.employerMatch;
            }
            // Blended = actual YTD + stale-gap fill + projected remaining.
            // Stale gap: periods between last performance update and today,
            // filled at current projected rate. Actuals are trusted (may
            // reflect old contribution rates or salary changes).
            const remaining = methodRemainingFraction(
              rawContrib.contributionMethod,
            );
            const ytdEmp = contribActual?.contributions ?? 0;
            const ytdMatch = contribActual?.employerMatch ?? 0;
            if (ytdEmp > 0 || ytdMatch > 0) {
              // Compute stale gap from performance freshness date.
              // Only applies to payroll-cadence contributions (percent_of_salary,
              // fixed_per_period). Monthly/annual contributions follow their own
              // schedule — a biweekly payday gap doesn't mean they're stale.
              let stalePeriods = 0;
              const isPayrollCadence =
                rawContrib.contributionMethod === "percent_of_salary" ||
                rawContrib.contributionMethod === "fixed_per_period";
              if (
                isPayrollCadence &&
                perfLastUpdated &&
                activeJob.anchorPayDate
              ) {
                const anchor = new Date(activeJob.anchorPayDate);
                const periodsAtPerfDate = countPeriodsElapsed(
                  perfLastUpdated,
                  activeJob.payPeriod,
                  anchor,
                );
                stalePeriods = Math.max(
                  0,
                  periodsElapsedYtd - periodsAtPerfDate,
                );
              }
              if (stalePeriods > 0) entry.ytdDataStale = true;
              const perPeriodEmp = acct.annualContribution / periodsPerYear;
              const perPeriodMatch = acct.employerMatch / periodsPerYear;
              entry.blendedEmployee +=
                ytdEmp +
                perPeriodEmp * stalePeriods +
                acct.annualContribution * remaining;
              entry.blendedMatch +=
                ytdMatch +
                perPeriodMatch * stalePeriods +
                acct.employerMatch * remaining;
            } else {
              entry.blendedEmployee += acct.annualContribution;
              entry.blendedMatch += acct.employerMatch;
            }
            const pyAmt =
              rawContrib.priorYearContribYear === priorYear
                ? toNumber(rawContrib.priorYearContribAmount)
                : 0;
            entry.priorYearAmount += pyAmt;
            entry.priorYearContribs.push({ id: rawContrib.id, amount: pyAmt });
            entry.employee += acct.annualContribution;
            entry.match += acct.employerMatch;
            // Four-way tax-treatment split — after_tax and hsa must NOT be
            // folded into "trad" (that used to silently mislabel taxable
            // brokerage and HSA dollars as Traditional/pre-tax).
            if (isTaxFree(acct.taxTreatment))
              entry.taxFree += acct.annualContribution;
            else if (acct.taxTreatment === "after_tax")
              entry.afterTax += acct.annualContribution;
            // lint-violation-ok: taxTreatment value, not an accountType/category comparison
            else if (acct.taxTreatment === "hsa")
              entry.hsa += acct.annualContribution;
            else entry.trad += acct.annualContribution;
            if (rawContrib.ownership === "joint") entry.isJoint = true;
            categoryMap.set(cat, entry);
          }

          // Determine limits per category — uses resolveContribLimit with HSA coverage from raw data
          // Takes the raw DB category key (categoryKey), not the display label
          const getLimitForCategory = (rawCat: string): number => {
            const hsaAcct = rawContribs.find((c) => c.accountType === rawCat);
            return resolveContribLimit(
              rawCat,
              hsaAcct?.hsaCoverageType ?? null,
            );
          };

          const accountTypes: AccountTypeSnapshot[] = [];
          for (const [cat, data] of Array.from(categoryMap)) {
            const limit = getLimitForCategory(data.categoryKey);
            const employeeContrib = roundToCents(data.employee);
            const employerMatch = roundToCents(data.match);
            const bonusAdd = isInLimit401kGroup(data.categoryKey)
              ? bonus401k
              : 0;
            const totalEmployee = employeeContrib + bonusAdd;
            const cfg = categoriesWithIrsLimit().includes(
              data.categoryKey as AccountCategory,
            )
              ? getAccountTypeConfig(data.categoryKey as AccountCategory)
              : null;
            let currentPctOfSalary: number | null = null;
            if (limit > 0 && salary > 0) {
              currentPctOfSalary =
                roundToCents((totalEmployee / salary) * 100 * 100) / 100;
            }

            const ytdActualForCategory =
              data.ytdContributions > 0 || data.ytdEmployerMatch > 0
                ? {
                    contributions: data.ytdContributions,
                    employerMatch: data.ytdEmployerMatch,
                  }
                : null;
            const blendedEmployee =
              roundToCents(data.blendedEmployee) + bonusAdd;
            const blendedMatch = roundToCents(data.blendedMatch);
            const views = computeViewAwareAccountMetrics({
              projected: {
                employeeContrib: totalEmployee,
                employerMatch,
              },
              blended: {
                employeeContrib: blendedEmployee,
                employerMatch: blendedMatch,
              },
              ytdActual: ytdActualForCategory,
              limit,
              salary,
              matchCountsTowardLimit: cfg?.matchCountsTowardLimit ?? false,
            });

            // Prior-year contribution data (only during IRS window for eligible types)
            let priorYearSnapshot: AccountTypeSnapshot["priorYear"];
            if (inPriorYearWindow && cfg?.supportsPriorYearContrib) {
              const hsaAcct = rawContribs.find(
                (c) => c.accountType === data.categoryKey,
              );
              const pyLimit = resolveContribPriorYearLimit(
                data.categoryKey,
                hsaAcct?.hsaCoverageType ?? null,
              );
              if (pyLimit > 0) {
                priorYearSnapshot = {
                  amount: roundToCents(data.priorYearAmount),
                  limit: pyLimit,
                  remaining: Math.max(
                    0,
                    pyLimit - roundToCents(data.priorYearAmount),
                  ),
                  contribs: data.priorYearContribs,
                };
              }
            }

            accountTypes.push({
              accountType: cat,
              categoryKey: data.categoryKey,
              parentCategory: data.parentCategory,
              limit,
              employeeContrib: totalEmployee,
              employerMatch,
              totalContrib: totalEmployee + employerMatch,
              views,
              ytdDataStale: data.ytdDataStale,
              currentPctOfSalary,
              tradContrib: roundToCents(data.trad),
              taxFreeContrib: roundToCents(data.taxFree),
              afterTaxContrib: roundToCents(data.afterTax),
              hsaContrib: roundToCents(data.hsa),
              bonusContrib: bonusAdd,
              isJoint: data.isJoint,
              hasDiscountBar: data.hasDiscountBar,
              employerMatchLabel: data.employerMatchLabel,
              targetAnnual: data.targetAnnual,
              allocationPriority: data.allocationPriority,
              priorYear: priorYearSnapshot,
            });
          }

          // Sort: config-defined accumulation order (using categoryKey for lookup), then others
          const order = getDefaultAccumulationOrder() as string[];
          accountTypes.sort((a, b) => {
            const ai = order.indexOf(a.categoryKey);
            const bi = order.indexOf(b.categoryKey);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });

          // Compute totals — use DB parentCategory (not config lookup) so sub-types
          // like ESPP (categoryKey "espp") are correctly grouped by their stored category
          const retirement = accountTypes.filter((a) =>
            isRetirementParent(a.parentCategory),
          );
          const portfolio = accountTypes.filter((a) =>
            isPortfolioParent(a.parentCategory),
          );
          const retirementWithoutMatch = roundToCents(
            retirement.reduce((s, a) => s + a.employeeContrib, 0),
          );
          const retirementWithMatch = roundToCents(
            retirement.reduce((s, a) => s + a.totalContrib, 0),
          );
          const portfolioWithoutMatch = roundToCents(
            portfolio.reduce((s, a) => s + a.employeeContrib, 0),
          );
          const portfolioWithMatch = roundToCents(
            portfolio.reduce((s, a) => s + a.totalContrib, 0),
          );

          // YTD actuals from performance data — sum by parent category
          const ytdActualRetirement = roundToCents(
            perContribData
              .filter((_pcd, idx) =>
                isRetirementParent(rawContribs[idx]?.parentCategory ?? ""),
              )
              .reduce((s, pcd) => s + (pcd.ytdActual?.contributions ?? 0), 0),
          );
          const ytdActualPortfolio = roundToCents(
            perContribData
              .filter((_pcd, idx) =>
                isPortfolioParent(rawContribs[idx]?.parentCategory ?? ""),
              )
              .reduce((s, pcd) => s + (pcd.ytdActual?.contributions ?? 0), 0),
          );
          const ytdActualRetirementMatch = roundToCents(
            perContribData
              .filter((_pcd, idx) =>
                isRetirementParent(rawContribs[idx]?.parentCategory ?? ""),
              )
              .reduce((s, pcd) => s + (pcd.ytdActual?.employerMatch ?? 0), 0),
          );
          const ytdActualPortfolioMatch = roundToCents(
            perContribData
              .filter((_pcd, idx) =>
                isPortfolioParent(rawContribs[idx]?.parentCategory ?? ""),
              )
              .reduce((s, pcd) => s + (pcd.ytdActual?.employerMatch ?? 0), 0),
          );

          // Blended totals: sum per-category blended amounts (method-aware remaining fractions)
          const catEntries = Array.from(categoryMap.entries());
          const retCats = catEntries.filter(([, d]) =>
            isRetirementParent(d.parentCategory),
          );
          const portCats = catEntries.filter(([, d]) =>
            isPortfolioParent(d.parentCategory),
          );
          const blendedRetWithoutMatch = roundToCents(
            retCats.reduce((s, [, d]) => s + d.blendedEmployee, 0) + bonus401k,
          );
          const blendedRetWithMatch = roundToCents(
            retCats.reduce(
              (s, [, d]) => s + d.blendedEmployee + d.blendedMatch,
              0,
            ) + bonus401k,
          );
          const blendedPortWithoutMatch = roundToCents(
            portCats.reduce((s, [, d]) => s + d.blendedEmployee, 0),
          );
          const blendedPortWithMatch = roundToCents(
            portCats.reduce(
              (s, [, d]) => s + d.blendedEmployee + d.blendedMatch,
              0,
            ),
          );

          const ytdRatioForTotals = safeDivide(
            periodsElapsedYtd,
            periodsPerYear,
            0,
          );

          // Salary is a flat number under the active Salary Profile — no
          // mid-year timeline to blend across any more (see
          // resolveCompensation's docblock), so blended and projected total
          // compensation are the same figure.
          const blendedTotalCompensation = totalCompensation;

          const totalsViews = computeViewAwareTotals({
            projected: {
              retirementWithoutMatch,
              retirementWithMatch,
              portfolioWithoutMatch,
              portfolioWithMatch,
            },
            blended: {
              retirementWithoutMatch: blendedRetWithoutMatch,
              retirementWithMatch: blendedRetWithMatch,
              portfolioWithoutMatch: blendedPortWithoutMatch,
              portfolioWithMatch: blendedPortWithMatch,
            },
            ytdActuals: {
              retirement: ytdActualRetirement,
              portfolio: ytdActualPortfolio,
              retirementMatch: ytdActualRetirementMatch,
              portfolioMatch: ytdActualPortfolioMatch,
            },
            ytdRatio: ytdRatioForTotals,
            totalCompensation,
            blendedTotalCompensation,
          });

          return {
            person,
            salary,
            totalCompensation,
            bonusGross,
            periodsPerYear,
            periodsElapsedYtd,
            accountTypes,
            perContribData,
            totals: {
              views: totalsViews,
              ytdActualRetirement,
              ytdActualPortfolio,
              ytdActualRetirementMatch,
              ytdActualPortfolioMatch,
            },
            result,
          };
        }),
      );

      // Joint accounts — computed at household level, not attributed to any person
      const jointContribs = effectiveContribs.filter(
        (c) => c.ownership === "joint",
      );
      const jointAccountTypes: AccountTypeSnapshot[] = [];
      for (const c of jointContribs) {
        const val = toNumber(String(c.contributionValue));
        const periodsPerYear =
          results[0]?.periodsPerYear ?? DEFAULT_PAY_PERIODS_PER_YEAR;
        const salary = 0;
        const annual =
          c.contributionMethod === "percent_of_salary"
            ? salary * (val / 100)
            : c.contributionMethod === "fixed_per_period"
              ? val * periodsPerYear
              : c.contributionMethod === "fixed_monthly"
                ? val * 12
                : val;
        const matchAnnual =
          c.employerMatchType === "fixed_annual"
            ? toNumber(c.employerMatchValue)
            : 0;

        const linkedPerfLabel = c.performanceAccountId
          ? perfLabelMap.get(c.performanceAccountId)
          : null;

        const jDisplay = getDisplayConfig(c.accountType, c.subType);

        let displayCat: string = jDisplay.displayLabel;
        if (isOverflowTarget(c.accountType as AccountCategory)) {
          if (
            jDisplay.hasDiscountBar ||
            jDisplay.displayLabel.toLowerCase() !== c.accountType.toLowerCase()
          ) {
            displayCat = jDisplay.displayLabel;
          } else if (linkedPerfLabel) {
            displayCat = linkedPerfLabel;
          } else if (c.label) {
            displayCat = `${c.label} Brokerage`;
          } else {
            displayCat = isRetirementCategory(c.accountType as AccountCategory)
              ? "Retirement Brokerage"
              : "Long Term Brokerage";
          }
        }

        // Color key: sub-type key if sub-type display matched, otherwise base accountType
        const jColorKey =
          c.subType &&
          jDisplay.displayLabel.toLowerCase() !== c.accountType.toLowerCase()
            ? c.subType.toLowerCase()
            : c.accountType;

        const jointViewMetrics: AccountViewMetrics = {
          employeeContrib: roundToCents(annual),
          employerMatch: roundToCents(matchAnnual),
          totalContrib: roundToCents(annual + matchAnnual),
          fundingPct: 0,
          fundingMissing: 0,
          pctOfSalaryToMax: null,
        };
        jointAccountTypes.push({
          accountType: displayCat,
          categoryKey: jColorKey,
          parentCategory: c.parentCategory,
          limit: 0,
          employeeContrib: roundToCents(annual),
          employerMatch: roundToCents(matchAnnual),
          totalContrib: roundToCents(annual + matchAnnual),
          views: {
            projected: jointViewMetrics,
            blended: jointViewMetrics,
            ytd: jointViewMetrics,
          },
          ytdDataStale: false,
          currentPctOfSalary: null,
          tradContrib: c.taxTreatment === "pre_tax" ? roundToCents(annual) : 0,
          taxFreeContrib: isTaxFree(c.taxTreatment) ? roundToCents(annual) : 0,
          afterTaxContrib:
            c.taxTreatment === "after_tax" ? roundToCents(annual) : 0,
          // lint-violation-ok: taxTreatment value, not an accountType/category comparison
          hsaContrib: c.taxTreatment === "hsa" ? roundToCents(annual) : 0,
          bonusContrib: 0,
          isJoint: true,
          hasDiscountBar: jDisplay.hasDiscountBar,
          employerMatchLabel: jDisplay.employerMatchLabel,
          targetAnnual: c.targetAnnual ? Number(c.targetAnnual) : null,
          allocationPriority: c.allocationPriority ?? 0,
        });
      }

      const jointTotals = {
        totalWithoutMatch: roundToCents(
          jointAccountTypes.reduce((s, a) => s + a.employeeContrib, 0),
        ),
        totalWithMatch: roundToCents(
          jointAccountTypes.reduce((s, a) => s + a.totalContrib, 0),
        ),
      };

      return {
        people: results,
        limits: limitsRecord,
        jointAccountTypes,
        jointTotals,
        priorYearWindow: inPriorYearWindow
          ? { priorYear, deadline: `April 15, ${currentYear}` }
          : null,
      };
    }),
});
