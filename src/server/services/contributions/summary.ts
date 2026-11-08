/** The contribution summary (contribution.computeSummary). Its input: the
 *  profile pair and the What-If tab's contribution and salary edits. */
import { z } from "zod/v4";
import {
  zSandboxSalaryEntries,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  loadLiveContributions,
  liveYearToDate,
} from "@/server/services/investments/live-contributions";
import {
  contribRemainingFraction,
  monthsDoneYtd,
  monthsElapsedYtd,
  periodsElapsedYtd,
  checksPaidYtd,
} from "@/lib/pure/paycheck/pay-periods-in-year";
import {
  bonusCheckContribution,
  isPaidThroughPayroll,
} from "@/lib/pure/paycheck/bonus";
import { accountDisplayName, stripInstitutionSuffix } from "@/lib/utils/format";
import { applySandboxSalaryEntries } from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { loadAndApplyContribProfile } from "@/server/services/contributions/profile";
import { applyContribActiveFields } from "@/server/services/contributions/profile";
import { buildSandboxContribRow } from "@/server/services/contributions/profile";
import { toNumber } from "@/lib/utils/numbers";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { getAllPeople } from "@/server/data/people";
import { roundToCents, safeDivide } from "@/lib/utils/math";
import type {
  AccountTypeSnapshot,
  PersonSnapshot,
} from "@/lib/pure/contributions/summary.types";
import { jointAccountRows } from "@/lib/pure/contributions/joint-accounts";
import {
  contribAccountsFor,
  perContribRows,
  personPay,
} from "@/lib/pure/contributions/person-snapshot";
import {
  accountTypeSnapshots,
  contributionTotals,
  newCategoryMap,
} from "@/lib/pure/contributions/account-type-snapshots";
import { DEFAULT_PAY_PERIODS_PER_YEAR } from "@/lib/constants";
import { isPriorYearContribWindow } from "@/lib/utils/date";
import { ageOnDate } from "@/lib/pure/household/age";
import { computeViewAwareTotals } from "@/lib/pure/contributions/view-metrics";
import { findActiveJob } from "@/lib/pure/household/profiles";
import { loadCapHousehold } from "@/server/services/contributions/caps";
import { capForRequest } from "@/lib/pure/contributions/cap-pass";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  isOverflowTarget,
  getDisplayConfig,
  isRetirementCategory,
  isTaxFree,
  isAfterTaxTreatment,
  isHsaTreatment,
} from "@/lib/config/account-types";
import { splitYtdActuals } from "@/lib/pure/contributions/ytd-actuals";

export const zContributionSummaryInput = z
  .object({
    contributionProfileId: z.number().int().optional(),
    salaryProfileId: z.number().int().optional(),
    /** Sent with the paycheck summary's identical field, so the pay stub
     *  and the contribution cards agree. */
    sandboxSalaryEntries: zSandboxSalaryEntries,
    /** Sent with the paycheck summary's identical field, so the pay stub
     *  and the contribution cards agree. */
    sandboxContribActiveFields: zSandboxContribActiveFields,
    /** See the paycheck summary's identical field. */
    sandboxContribAdditions: zSandboxContribAdditions,
  })
  .optional();

export async function computeContributionSummary(
  ctx: { db: Db; scope: RequestScope },
  input: z.output<typeof zContributionSummaryInput>,
) {
  const currentYear = ctx.scope.asOf.getFullYear();
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
    ctx.scope.load(getAllPeople),
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
        performanceAccountId: schema.accountPerformance.performanceAccountId,
        totalContributions: schema.accountPerformance.totalContributions,
        employerContributions: schema.accountPerformance.employerContributions,
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
  // With the portfolio permission, actuals are live (Performance + what
  // SimpleFIN has seen since + what's on its way, through today) — see
  // investments/live-contributions. Those accounts need no stale-gap fill.
  const live = ctx.scope.can("portfolio")
    ? await loadLiveContributions(ctx.db, ctx.scope.asOf)
    : null;
  const liveThroughToday = new Set<number>();
  // The day each live account's latest contribution actually arrived —
  // a month already paid into counts as done (monthsDoneYtd).
  const contributedThrough = new Map(
    (live ?? [])
      .filter((c) => c.latestContributionDay !== null)
      .map((c) => [c.performanceAccountId, c.latestContributionDay!]),
  );
  // total_contributions includes employer match — split into employee-only + match
  for (const row of currentYearPerfActuals) {
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

  for (const c of live ?? []) {
    const ytd = liveYearToDate(c);
    if (ytd.contributions === 0 && ytd.employerMatch === 0) continue;
    perfActualMap.set(c.performanceAccountId, ytd);
    liveThroughToday.add(c.performanceAccountId);
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
  // The What-If sandbox's salaries; the Contribution Profile sets
  // account/job fields only. No explicit salaryProfileId
  // falls back to the globally-active profile.
  const effectiveSalaryMap = applySandboxSalaryEntries(
    input?.sandboxSalaryEntries,
    new Map(),
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
    salaryProfileActiveMap,
  );
  // Sandbox edits are the highest-precedence tier, applied AFTER the
  // picked profile's own overrides via the SAME merge function.
  const sandboxed = applyContribActiveFields(
    profileResult.contribs,
    input?.sandboxContribActiveFields ?? {},
    true,
  );
  for (const [i, addition] of (
    input?.sandboxContribAdditions ?? []
  ).entries()) {
    sandboxed.push(buildSandboxContribRow(addition, -(i + 1)));
  }
  const effectiveJobs = profileResult.jobs;

  const asOfDate = ctx.scope.asOf;
  // The IRS-limit cap pass: every figure below reads the capped value.
  const capHousehold = await loadCapHousehold(
    ctx.db,
    people,
    limitsRecord,
    asOfDate,
  );
  const effectiveContribs = capForRequest(
    sandboxed,
    capHousehold,
    effectiveJobs,
    salaryProfileActiveMap,
    effectiveSalaryMap,
  );

  const { contribActualMap } = splitYtdActuals(
    effectiveContribs,
    effectiveJobs,
    salaryProfileActiveMap,
    effectiveSalaryMap,
    asOfDate,
    perfActualMap,
  );

  const results: PersonSnapshot[] = await Promise.all(
    people.map(async (person) => {
      const activeJob = findActiveJob(effectiveJobs, person.id, asOfDate);
      // No active job, or no entry for it in the active Salary Profile
      // — same safe "nothing resolves" state either way.
      if (!activeJob || activeJob.payPeriod == null) {
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
                compensation: 0,
              },
              blended: {
                retirementWithoutMatch: 0,
                retirementWithMatch: 0,
                portfolioWithoutMatch: 0,
                portfolioWithMatch: 0,
                totalWithoutMatch: 0,
                totalWithMatch: 0,
                compensation: 0,
              },
              ytd: {
                retirementWithoutMatch: 0,
                retirementWithMatch: 0,
                portfolioWithoutMatch: 0,
                portfolioWithMatch: 0,
                totalWithoutMatch: 0,
                totalWithMatch: 0,
                compensation: 0,
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

      const { dbSalary, pay, salary, totalCompensation } = personPay(
        salaryProfileActiveMap,
        activeJob,
        effectiveSalaryMap,
        person,
      );
      const periodsPerYear = getPeriodsPerYear(activeJob.payPeriod);
      const periodsElapsed = periodsElapsedYtd(
        asOfDate,
        activeJob.payPeriod,
        activeJob.anchorPayDate,
        periodsPerYear,
      );
      const age = ageOnDate(person.dateOfBirth, asOfDate);

      const {
        bonusDate,
        accounts,
        rawContribs,
        result,
        resolveContribLimit,
        resolveContribPriorYearLimit,
      } = contribAccountsFor({
        effectiveContributions: effectiveContribs,
        activeJob,
        person,
        pay,
        asOfDate,
        salary,
        periodsPerYear,
        limitsRecord,
        totalCompensation,
        age,
        priorYearLimitsRecord,
      });

      // Build per-raw-contrib computed data for consumers (Paycheck page)
      const { perContribData } = perContribRows(
        rawContribs,
        accounts,
        resolveContribLimit,
        inPriorYearWindow,
        priorYear,
        resolveContribPriorYearLimit,
        contribActualMap,
      );

      // Build per-account-type snapshots
      // Group accounts by display category derived from DB columns
      const { categoryMap } = newCategoryMap();

      // Compute method-aware remaining fraction for blended estimates.
      // Each contribution method has a different delivery cadence.
      const elapsed = {
        periodsElapsed,
        periodsPerYear,
        monthsElapsed: monthsElapsedYtd(asOfDate),
      };
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
          matchAvailable: 0,
          trad: 0,
          taxFree: 0,
          afterTax: 0,
          hsa: 0,
          nonPayroll: 0,
          payrollDeducted: 0,
          isJoint: false,
          parentCategory: rawContrib.parentCategory,
          hasDiscountBar: display.hasDiscountBar,
          employerMatchLabel: display.employerMatchLabel,
          categoryKey,
          targetAnnual: rawContrib.targetAnnual
            ? Number(rawContrib.targetAnnual)
            : null,
          allocationPriority: rawContrib.allocationPriority,
          priorYearAmount: 0,
          priorYearContribs: [],
          ytdContributions: 0,
          ytdEmployerMatch: 0,
          blendedEmployee: 0,
          blendedMatch: 0,
          ytdDataStale: false,
          performanceAccountIds: new Set<number>(),
          electedPct: 0,
          bonus: 0,
          fullMatchShareOfPay: null,
        };
        // What the bonus check takes, and the match on it. The Year-End
        // estimate adds them only when the year's actuals don't already
        // hold that check (paid after the date they run through).
        const bonusEmp = bonusCheckContribution(acct, pay.bonusGross);
        const bonusMatch = acct.employerMatchOnBonus ?? 0;
        entry.bonus += bonusEmp;
        entry.fullMatchShareOfPay =
          acct.fullMatchShareOfPay ?? entry.fullMatchShareOfPay;
        entry.electedPct =
          entry.electedPct !== null &&
          rawContrib.contributionMethod === "percent_of_salary"
            ? entry.electedPct + toNumber(String(rawContrib.contributionValue))
            : null;
        if (rawContrib.performanceAccountId != null)
          entry.performanceAccountIds.add(rawContrib.performanceAccountId);
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
        const remaining = contribRemainingFraction(
          rawContrib.contributionMethod,
          {
            ...elapsed,
            monthsElapsed: monthsDoneYtd(
              asOfDate,
              rawContrib.performanceAccountId != null
                ? contributedThrough.get(rawContrib.performanceAccountId)
                : null,
            ),
          },
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
            activeJob.anchorPayDate &&
            !(
              rawContrib.performanceAccountId != null &&
              liveThroughToday.has(rawContrib.performanceAccountId)
            )
          ) {
            // Checks this job paid since the data's date — a payday
            // before a start this year isn't a missed contribution.
            const { payPeriod } = activeJob;
            const paid = (at: Date) =>
              checksPaidYtd(
                at,
                payPeriod,
                activeJob.anchorPayDate,
                periodsPerYear,
                activeJob.startDate,
              );
            stalePeriods = Math.max(0, paid(asOfDate) - paid(perfLastUpdated));
          }
          if (stalePeriods > 0) entry.ytdDataStale = true;
          const regularMatch = acct.employerMatch - bonusMatch;
          const perPeriodEmp = acct.annualContribution / periodsPerYear;
          const perPeriodMatch = regularMatch / periodsPerYear;
          const actualsThrough =
            rawContrib.performanceAccountId != null &&
            liveThroughToday.has(rawContrib.performanceAccountId)
              ? asOfDate
              : perfLastUpdated;
          const bonusInActuals =
            bonusDate !== null &&
            actualsThrough != null &&
            bonusDate <= actualsThrough;
          entry.blendedEmployee +=
            ytdEmp +
            perPeriodEmp * stalePeriods +
            acct.annualContribution * remaining +
            (bonusInActuals ? 0 : bonusEmp);
          entry.blendedMatch +=
            ytdMatch +
            perPeriodMatch * stalePeriods +
            regularMatch * remaining +
            (bonusInActuals ? 0 : bonusMatch);
        } else {
          entry.blendedEmployee += acct.annualContribution + bonusEmp;
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
        entry.matchAvailable +=
          acct.employerMatchAvailable ?? acct.employerMatch;
        // Four-way tax-treatment split — after_tax and hsa must NOT be
        // folded into "trad" (that used to silently mislabel taxable
        // brokerage and HSA dollars as Traditional/pre-tax).
        // Bonus-check money lands in the same bucket as the account's.
        const withBonus = acct.annualContribution + bonusEmp;
        if (isTaxFree(acct.taxTreatment)) entry.taxFree += withBonus;
        else if (isAfterTaxTreatment(acct.taxTreatment))
          entry.afterTax += withBonus;
        else if (isHsaTreatment(acct.taxTreatment)) entry.hsa += withBonus;
        else entry.trad += withBonus;
        // Same isPayrollDeducted resolution the paycheck summary's
        // calculator input uses (buildContribAccounts) — independent of the
        // tax treatment split above.
        if (isPaidThroughPayroll(rawContrib)) {
          entry.payrollDeducted += withBonus;
        } else {
          entry.nonPayroll += acct.annualContribution;
        }
        if (rawContrib.ownership === "joint") entry.isJoint = true;
        categoryMap.set(cat, entry);
      }

      // Determine limits per category — uses resolveContribLimit with HSA coverage from raw data
      // Takes the raw DB category key (categoryKey), not the display label
      // Coverage across every row of the type — family if any row is
      // family — the same rule the label and the cap use.
      const { accountTypes } = accountTypeSnapshots(
        rawContribs,
        resolveContribLimit,
        categoryMap,
        salary,
        inPriorYearWindow,
        resolveContribPriorYearLimit,
      );

      // Compute totals — use DB parentCategory (not config lookup) so sub-types
      // like ESPP (categoryKey "espp") are correctly grouped by their stored category
      const {
        retirementWithoutMatch,
        retirementWithMatch,
        portfolioWithoutMatch,
        portfolioWithMatch,
        ytdActualRetirement,
        ytdActualPortfolio,
        ytdActualRetirementMatch,
        ytdActualPortfolioMatch,
        blendedRetWithoutMatch,
        blendedRetWithMatch,
        blendedPortWithoutMatch,
        blendedPortWithMatch,
      } = contributionTotals(
        accountTypes,
        perContribData,
        rawContribs,
        categoryMap,
      );

      // Year-to-date share of a FULL year (checks paid ÷ checks a
      // year): this page's yearly figures are full-year rates. Not the
      // snapshot's ytdRatio, which divides by the checks this job pays
      // this year (it projects this year's own total).
      const ytdRatioForTotals = safeDivide(
        checksPaidYtd(
          asOfDate,
          activeJob.payPeriod,
          activeJob.anchorPayDate,
          periodsPerYear,
          activeJob.startDate,
        ),
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
        bonusGross: roundToCents(totalCompensation - dbSalary),
        periodsPerYear,
        periodsElapsedYtd: periodsElapsed,
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
  // A joint account's IRS limit (a family HSA) through the same resolver
  // as each person's, at the oldest member's age for any catch-up.
  const householdAge = Math.max(
    0,
    ...people.map((p) => ageOnDate(p.dateOfBirth, asOfDate)),
  );
  jointAccountRows(
    jointContribs,
    results,
    perfLabelMap,
    asOfDate,
    liveThroughToday,
    perfActualMap,
    contributedThrough,
    householdAge,
    limitsRecord,
    jointAccountTypes,
  );

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
    /** The cap pass's filing status — whether an HSA limit is shared. */
    filingStatus: capHousehold.filingStatus,
    jointAccountTypes,
    jointTotals,
    priorYearWindow: inPriorYearWindow
      ? { priorYear, deadline: `April 15, ${currentYear}` }
      : null,
  };
}
