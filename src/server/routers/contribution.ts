/** Contribution router for computing per-account contribution allocations, IRS limits, employer matches, and accumulation order across retirement and brokerage accounts. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateContributions } from "@/lib/calculators/contribution";
import {
  countPeriodsElapsed,
  mapSalaryTimelineToPeriods,
} from "@/lib/calculators/paycheck";
import { accountDisplayName, stripInstitutionSuffix } from "@/lib/utils/format";
import {
  toNumber,
  getPeriodsPerYear,
  getCurrentSalary,
  getEffectiveIncome,
  getTotalCompensation,
  buildContribAccounts,
  computeAnnualContribution,
  computeBonusGross,
  loadAndApplyContribProfile,
  getSalaryTimelineForYear,
} from "@/server/helpers";
import { roundToCents } from "@/lib/utils/math";
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
  tradContrib: number;
  taxFreeContrib: number;
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
    /** Actual YTD employer match from performance data. */
    ytdActualMatch: number;
  };
  result: ReturnType<typeof calculateContributions> | null;
};

export const contributionRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(
      z
        .object({
          salaryOverrides: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          contributionProfileId: z.number().int().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const salaryOverrideMap = new Map(
        (input?.salaryOverrides ?? []).map(
          (o) => [o.personId, o.salary] as const,
        ),
      );
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
      ]);

      // Build YTD actuals lookup: performanceAccountId → { contributions, employerMatch }
      const perfActualMap = new Map<
        number,
        { contributions: number; employerMatch: number }
      >();
      for (const row of currentYearPerfActuals) {
        if (row.performanceAccountId == null) continue;
        const existing = perfActualMap.get(row.performanceAccountId);
        if (existing) {
          existing.contributions += toNumber(row.totalContributions);
          existing.employerMatch += toNumber(row.employerContributions);
        } else {
          perfActualMap.set(row.performanceAccountId, {
            contributions: toNumber(row.totalContributions),
            employerMatch: toNumber(row.employerContributions),
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

      // Apply contribution profile overrides if selected
      const profileResult = await loadAndApplyContribProfile(
        ctx.db,
        input?.contributionProfileId,
        allContribs,
        allJobs,
        salaryOverrideMap,
      );
      const effectiveContribs = profileResult.contribs;
      const effectiveJobs = profileResult.jobs;
      const effectiveSalaryMap = profileResult.salaryMap;

      const asOfDate = new Date();

      // Split YTD actuals proportionally when multiple contribs share a perf account.
      // Uses salary-timeline-aware expected YTD (not projected annual) so mid-year
      // salary changes are reflected in the split ratio.
      const contribActualMap = new Map<
        number,
        { contributions: number; employerMatch: number }
      >();
      {
        const activeContribs = effectiveContribs.filter((c) => c.isActive);
        const currentYear = asOfDate.getFullYear();

        // Cache salary timelines and period data per job to avoid redundant DB calls
        const jobCache = new Map<
          number,
          {
            timeline: { salary: number; effectiveDate: string | null }[];
            periodsPerYear: number;
            periodsElapsed: number;
            anchorPayDate: Date | null;
            payPeriod: string;
          }
        >();
        for (const c of activeContribs) {
          if (c.performanceAccountId == null || !c.jobId) continue;
          if (jobCache.has(c.jobId)) continue;
          const job = effectiveJobs.find((j) => j.id === c.jobId);
          if (!job) continue;
          const timeline = await getSalaryTimelineForYear(
            ctx.db,
            job.id,
            job.annualSalary,
            currentYear,
          );
          const periodsPerYear = getPeriodsPerYear(job.payPeriod);
          const anchor = job.anchorPayDate ? new Date(job.anchorPayDate) : null;
          const periodsElapsed = anchor
            ? countPeriodsElapsed(asOfDate, job.payPeriod, anchor)
            : Math.round((asOfDate.getMonth() / 12) * periodsPerYear);
          jobCache.set(c.jobId, {
            timeline,
            periodsPerYear,
            periodsElapsed,
            anchorPayDate: anchor,
            payPeriod: job.payPeriod,
          });
        }

        // Compute expected YTD for each contrib and group by perf account
        const byPerfId = new Map<
          number,
          { contribId: number; expectedYtd: number }[]
        >();
        for (const c of activeContribs) {
          if (c.performanceAccountId == null) continue;
          const value = toNumber(c.contributionValue);
          let expectedYtd = 0;

          const jd = c.jobId ? jobCache.get(c.jobId) : null;
          if (c.contributionMethod === "percent_of_salary" && jd) {
            // Walk salary timeline periods to compute exact YTD
            const segments = mapSalaryTimelineToPeriods(
              jd.timeline,
              jd.payPeriod,
              jd.anchorPayDate ?? new Date(`${currentYear}-01-15T00:00:00`),
              currentYear,
            );
            const pct = value / 100;
            for (const seg of segments) {
              const segPeriods =
                Math.min(seg.endPeriod, jd.periodsElapsed) -
                seg.startPeriod +
                1;
              if (segPeriods <= 0) continue;
              expectedYtd +=
                seg.salary * pct * (segPeriods / jd.periodsPerYear);
            }
          } else {
            // Fixed methods: scale by elapsed fraction
            const periodsPerYear = jd?.periodsPerYear ?? 26;
            const periodsElapsed = jd?.periodsElapsed ?? 0;
            const annual = computeAnnualContribution(
              c.contributionMethod,
              value,
              0,
              periodsPerYear,
            );
            expectedYtd = annual * (periodsElapsed / periodsPerYear);
          }

          const arr = byPerfId.get(c.performanceAccountId) ?? [];
          arr.push({ contribId: c.id, expectedYtd });
          byPerfId.set(c.performanceAccountId, arr);
        }

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
              periodsPerYear: 26,
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
                ytdActualMatch: 0,
              },
              result: null,
            };
          }

          const dbSalary = await getCurrentSalary(
            ctx.db,
            activeJob.id,
            activeJob.annualSalary,
            asOfDate,
          );
          const salary =
            effectiveSalaryMap.get(person.id) ??
            getEffectiveIncome(activeJob, dbSalary);
          // Total compensation (always includes bonus) — used for savings rate denominator
          const totalCompensation = getTotalCompensation(activeJob, dbSalary);
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
            activeJob.bonusPercent,
            activeJob.bonusMultiplier,
            activeJob.bonusOverride,
            activeJob.monthsInBonusYear,
          );

          // Estimate bonus contributions for categories in the 401k limit group (if include401kInBonus is set)
          let bonus401k = 0;
          if (activeJob.include401kInBonus && bonusGross > 0) {
            const bonusPct = rawContribs
              .filter(
                (c) =>
                  getLimitGroup(c.accountType as AccountCategory) === "401k" &&
                  c.contributionMethod === "percent_of_salary",
              )
              .reduce((s, c) => s + toNumber(c.contributionValue) / 100, 0);
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
            // Per-contrib blended: max(ytdActual, expectedYtd) + annual * remaining.
            // When actual < expected, assume data lag (not missed contributions)
            // and fall back to projected. When actual > expected, use real pace.
            const remaining = methodRemainingFraction(
              rawContrib.contributionMethod,
            );
            const ytdEmp = contribActual?.contributions ?? 0;
            const ytdMatch = contribActual?.employerMatch ?? 0;
            if (ytdEmp > 0 || ytdMatch > 0) {
              const expectedEmp = acct.annualContribution * (1 - remaining);
              const expectedMatch = acct.employerMatch * (1 - remaining);
              if (ytdEmp < expectedEmp * 0.95) entry.ytdDataStale = true;
              entry.blendedEmployee +=
                Math.max(ytdEmp, expectedEmp) +
                acct.annualContribution * remaining;
              entry.blendedMatch +=
                Math.max(ytdMatch, expectedMatch) +
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
            if (isTaxFree(acct.taxTreatment))
              entry.taxFree += acct.annualContribution;
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
            const bonusAdd =
              getLimitGroup(data.categoryKey) === "401k" ? bonus401k : 0;
            const totalEmployee = employeeContrib + bonusAdd;
            const cfg = categoriesWithIrsLimit().includes(
              data.categoryKey as AccountCategory,
            )
              ? getAccountTypeConfig(data.categoryKey as AccountCategory)
              : null;
            const towardLimit = cfg?.matchCountsTowardLimit
              ? totalEmployee + employerMatch
              : totalEmployee;

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
            const blendedTowardLimit = cfg?.matchCountsTowardLimit
              ? blendedEmployee + blendedMatch
              : blendedEmployee;
            const views = computeViewAwareAccountMetrics({
              towardLimit,
              blendedTowardLimit,
              limit,
              salary,
              ytdActual: ytdActualForCategory,
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
          const ytdActualMatch = roundToCents(
            perContribData.reduce(
              (s, pcd) => s + (pcd.ytdActual?.employerMatch ?? 0),
              0,
            ),
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

          const ytdRatioForTotals =
            periodsPerYear > 0 ? periodsElapsedYtd / periodsPerYear : 0;
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
              match: ytdActualMatch,
            },
            ytdRatio: ytdRatioForTotals,
            totalCompensation,
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
              ytdActualMatch,
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
        const val = toNumber(c.contributionValue);
        const periodsPerYear = results[0]?.periodsPerYear ?? 26;
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

        const zeroMetrics: AccountViewMetrics = {
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
            projected: zeroMetrics,
            blended: zeroMetrics,
            ytd: zeroMetrics,
          },
          ytdDataStale: false,
          currentPctOfSalary: null,
          tradContrib: isTaxFree(c.taxTreatment) ? 0 : roundToCents(annual),
          taxFreeContrib: isTaxFree(c.taxTreatment) ? roundToCents(annual) : 0,
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
