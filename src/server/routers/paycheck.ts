/** Paycheck router for gross-to-net pay calculations including federal tax withholding (no state tax), pre-tax deductions, and per-period contribution breakdowns. */
import { localDateStr } from "@/lib/utils/date";
import {
  capForRequest,
  loadCapHousehold,
} from "@/server/helpers/contribution-caps";
import { DEFAULT_BONUS_DESTINATION } from "@/lib/config/enum-values";
import { eq } from "drizzle-orm";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  bonusCheckContribution,
  calculatePaycheck,
  checksPaidYtd,
  countPeriodsElapsed,
  calculateBlendedAnnual,
  withheldThroughPeriod,
} from "@/lib/calculators/paycheck";
import type { SalarySegment } from "@/lib/calculators/paycheck";
import { calculateHouseholdTax } from "@/lib/calculators/tax";
import { toTaxableIncomeBrackets } from "@/lib/calculators/tax-brackets";
import {
  toNumber,
  getPeriodsPerYear,
  getRegularPeriodsPerMonth,
  getBudgetFrequencyNote,
  resolveCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  buildContribAccounts,
  requireLimit,
  loadAndApplyContribProfile,
  loadEffectiveSalaryProfile,
  applyContribActiveFields,
  buildSandboxContribRow,
  buildPaycheckInputForJob,
  fetchContributionProfile,
  getIncompleteContribAccountIds,
  contributionPay,
} from "@/server/helpers";
import { getAllPeople } from "@/server/helpers/people";
import { applySandboxSalaryEntries } from "@/server/helpers/salary";
import {
  zSandboxSalaryEntries,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "./_shared";
import type {
  DeductionLine,
  TaxBracketInput,
  BlendedAnnualTotals,
} from "@/lib/calculators/types";
import {
  computeAnnualEarnings,
  sumHouseholdIncome,
} from "@/lib/pure/household-income";
import { rothIraRouteOf, rothIraSummary } from "@/lib/pure/roth-ira";
import { deductionLine, earningLines } from "@/lib/pure/paycheck-lines";
import { medicareLiabilityKey } from "@/lib/config/tax-params";
import { hsaCashBuffers } from "@/lib/pure/cash-positions";
import { isHsaCategory, isIraCategory } from "@/lib/config/account-types";
import { findActiveJob } from "@/lib/pure/profiles";
import { resolveTaxParams } from "@/lib/config/tax-params";
import { ficaCapContext } from "@/lib/pure/contributions";

/**
 * The standard deduction Pub 15-T's withholding tables were built on, read
 * off the tables themselves: the Step 2(c) checkbox table's first taxed
 * threshold is half of it. Usually the same as the tax-return figure in
 * contribution_limits, but not always — OBBBA raised the 2025 return
 * deduction to $31,500 MFJ after the 2025 withholding tables (built on
 * $30,000) were published, and payroll kept withholding on those tables.
 * Null when the year has no checkbox table for this filing status.
 */
function withholdingStandardDeduction(
  bracketRow: typeof schema.taxBrackets.$inferSelect,
  yearBrackets: readonly (typeof schema.taxBrackets.$inferSelect)[],
): number | null {
  const checkbox = yearBrackets.find(
    (b) =>
      b.taxYear === bracketRow.taxYear &&
      b.filingStatus === bracketRow.filingStatus &&
      b.w4Checkbox,
  );
  const threshold = checkbox?.brackets[1]?.threshold;
  return threshold === undefined ? null : threshold * 2;
}

/** Build TaxBracketInput from DB bracket row + limits. `yearBrackets`
 *  (the same year's rows) lets the W-4 adjustment follow the withholding
 *  tables' own standard deduction — see withholdingStandardDeduction.
 *  Required on purpose: without it the adjustment falls back to the
 *  tax-return deduction, which is wrong for 2025 withholding. */
export function buildBracketInput(
  bracketRow: typeof schema.taxBrackets.$inferSelect,
  limits: Map<string, number>,
  yearBrackets: readonly (typeof schema.taxBrackets.$inferSelect)[],
): TaxBracketInput {
  const brackets = bracketRow.brackets.map((b, i, arr) => ({
    min: b.threshold,
    max: i < arr.length - 1 ? arr[i + 1]!.threshold : null,
    rate: b.rate,
  }));

  const standardDeduction = requireLimit(
    limits,
    `standard_deduction_${bracketRow.filingStatus.toLowerCase()}`,
  );
  // Pub 15-T Worksheet 1A line 1g: the tables' standard deduction minus
  // the standard table's own first non-zero threshold — the threshold alone is only
  // ONE term of the real offset, not the whole thing. This previously
  // used `brackets[1].threshold`
  // alone as the full adjustment, e.g. $19,300 MFJ for 2026 instead of the
  // real $32,200 - $19,300 = $12,900, under-withholding a $120k MFJ
  // household by ~$768/yr at the 12% bracket, more at higher brackets.
  // Mirrors tax-estimation.ts's toOrdinaryBracketIncome, which computes
  // this same residual correctly — see that function's docblock. 0 for
  // w4Checkbox=true rows (2(c) tables assume no worksheet adjustment).
  const tableDeduction =
    withholdingStandardDeduction(bracketRow, yearBrackets) ?? standardDeduction;
  const w4Adjustment = bracketRow.w4Checkbox
    ? 0
    : Math.max(0, tableDeduction - (bracketRow.brackets[1]?.threshold ?? 0));

  return {
    filingStatus: bracketRow.filingStatus,
    w4Checkbox: bracketRow.w4Checkbox,
    brackets,
    w4Adjustment,
    standardDeduction,
    socialSecurityWageBase: requireLimit(limits, "ss_wage_base"),
    socialSecurityRate: requireLimit(limits, "fica_ss_rate"),
    medicareRate: requireLimit(limits, "fica_medicare_rate"),
    medicareAdditionalRate: requireLimit(limits, "fica_medicare_surtax_rate"),
    medicareAdditionalThreshold: requireLimit(
      limits,
      "fica_medicare_surtax_threshold",
    ),
  };
}

/**
 * Annual-liability variant of buildBracketInput: same limits, but brackets
 * reshaped into real Form 1040 taxable-income space via
 * toTaxableIncomeBrackets (calculateHouseholdTax's own standardDeduction
 * subtraction was double-counting against the un-reshaped Pub 15-T
 * withholding brackets). Requires the standard (non-2c) row — the 2(c)
 * half-tables have no 1040 analogue.
 */
export function buildLiabilityBracketInput(
  bracketRow: typeof schema.taxBrackets.$inferSelect,
  limits: Map<string, number>,
): TaxBracketInput {
  if (bracketRow.w4Checkbox) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This calculation needs standard W-4 tax brackets (not the multiple-jobs checkbox).",
    });
  }
  // No yearBrackets: the liability path never reads w4Adjustment.
  const base = buildBracketInput(bracketRow, limits, []);
  return { ...base, brackets: toTaxableIncomeBrackets(base.brackets) };
}

export const paycheckRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(
      z
        .object({
          taxYearOverride: z.number().int().min(2000).max(2100).optional(),
          contributionProfileId: z.number().int().optional(),
          salaryProfileId: z.number().int().optional(),
          /** The What-If tab's hand-edited salary/bonus entries — highest
           *  precedence tier, above the Salary Profile. See applySandboxSalaryEntries. */
          sandboxSalaryEntries: zSandboxSalaryEntries,
          /** The What-If tab's hand-edited amount for an existing deduction. */
          sandboxDeductionEdits: zSandboxDeductionEdits,
          /** The What-If tab's hand-added hypothetical deductions. */
          sandboxDeductionAdditions: zSandboxDeductionAdditions,
          /** The What-If tab's hand-edited contribution account values —
           *  one more layer on top of the picked Contribution Profile's own
           *  overrides, via the SAME applyContribActiveFields merge. */
          sandboxContribActiveFields: zSandboxContribActiveFields,
          /** The What-If tab's hand-added hypothetical contribution
           *  accounts — no DB row, personId-keyed. */
          sandboxContribAdditions: zSandboxContribAdditions,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const deductionEditMap = new Map(
        (input?.sandboxDeductionEdits ?? []).map((e) => [
          e.id,
          e.amountPerPeriod,
        ]),
      );
      const [
        people,
        allJobs,
        allDeductions,
        allContribs,
        allLimitRows,
        allBracketRows,
        allTaxParams,
        allEarnings,
      ] = await Promise.all([
        getAllPeople(ctx.db),
        ctx.db.select().from(schema.jobs),
        ctx.db.select().from(schema.paycheckDeductions),
        ctx.db
          .select()
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.isActive, true)),
        ctx.db.select().from(schema.contributionLimits),
        ctx.db.select().from(schema.taxBrackets),
        ctx.db.select().from(schema.taxParams),
        ctx.db.select().from(schema.paycheckEarnings),
      ]);

      // One resolver, same as the retirement engine — but "null" on a
      // missing year (not "throw"/"nearest"): the paycheck year selector
      // lets a user pick a year with no seeded tables, and the contract is
      // "show empty, never another year's figures" (a person entry still
      // renders, with paycheck/tax null). `taxYearOverride` undefined =>
      // newest enacted year.
      const resolvedTax = resolveTaxParams(
        {
          vintage: allTaxParams,
          contributionLimits: allLimitRows,
          withholdingBrackets: allBracketRows,
          ltcgBrackets: [],
          irmaaBrackets: [],
          fpl: [],
        },
        input?.taxYearOverride,
        { onMissing: "null" },
      );
      const taxYear =
        resolvedTax?.resolvedYear ??
        input?.taxYearOverride ??
        new Date().getFullYear();
      const allBrackets = resolvedTax
        ? allBracketRows.filter((b) => b.taxYear === resolvedTax.resolvedYear)
        : [];

      const limitsRecord: Record<string, number> = resolvedTax?.limits ?? {};
      const limitsMap = new Map<string, number>(Object.entries(limitsRecord));

      // Salary and contribution overrides are two independent axes.
      // Precedence for salary: the What-If sandbox (highest) > Salary
      // Profile. The Contribution Profile contributes no
      // salary at all — only account/job field overrides. No explicit
      // salaryProfileId falls back to the globally-active profile.
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
        allDeductions,
      );
      // getIncompleteContribAccountIds's signal (a real account with no
      // active value under this profile — see applyContribActiveFields,
      // which silently excludes it above) had no UI home anywhere before
      // this — surfaced per-person below so a card never just shows a
      // quietly-shrunk total.
      const contribProfileRow = await fetchContributionProfile(
        ctx.db,
        input?.contributionProfileId,
      );
      const accountActiveFields =
        (
          contribProfileRow?.contributionActiveFields as
            | { contributionAccounts?: Record<string, Record<string, unknown>> }
            | undefined
        )?.contributionAccounts ?? {};
      // The What-If tab's sandbox edits are the highest-precedence tier,
      // applied AFTER the picked profile's own overrides — same merge
      // function, one more layer, never a second resolution path.
      const sandboxed = applyContribActiveFields(
        profileResult.contribs,
        input?.sandboxContribActiveFields ?? {},
        true,
      );
      // Hypothetical additions have no DB row — appended for the duration
      // of this request only, never written anywhere. Negative ids can
      // never collide with a real autoincrement id.
      for (const [i, addition] of (
        input?.sandboxContribAdditions ?? []
      ).entries()) {
        sandboxed.push(buildSandboxContribRow(addition, -(i + 1)));
      }
      const effectiveJobs = profileResult.jobs;

      const asOfDate = new Date();
      // The IRS-limit cap pass: every figure below reads the capped value.
      const capHousehold = await loadCapHousehold(
        ctx.db,
        people,
        limitsRecord,
        taxYear,
        salaryProfileActiveMap,
      );
      const effectiveContribs = capForRequest(
        sandboxed,
        capHousehold,
        effectiveJobs,
        salaryProfileActiveMap,
        effectiveSalaryMap,
      );

      /**
       * One job's paycheck inputs, the same for the job a person has now
       * and one that ended this year: its W-4 brackets, salary and bonus
       * terms from the Salary Profile, its deductions, other pay and
       * contributions. `sandbox`: apply the What-If (the current job only).
       * Null when the job's Salary Profile entry is incomplete.
       */
      const jobPaycheckSetup = (
        job: (typeof effectiveJobs)[number],
        person: (typeof people)[number],
        opts: { sandbox: boolean; asOf?: Date },
      ) => {
        // job.w4FilingStatus is undefined when this job has no entry in
        // the active Salary Profile (an entry is always complete — see
        // mergeSalaryProfileJobFields): no bracket row = incomplete.
        const bracketRow = allBrackets.find(
          (b) =>
            b.filingStatus === job.w4FilingStatus &&
            b.w4Checkbox === job.w4Box2cChecked,
        );
        if (!bracketRow) return null;
        // A job has no salary/bonus of its own — the Salary Profile, then
        // (current job only) the What-If sandbox.
        const comp = resolveCompensation(salaryProfileActiveMap, job.id);
        const salary = opts.sandbox
          ? applyActiveSalary(person.id, comp.salary, effectiveSalaryMap)
          : comp.salary;
        const periodsPerYear = getPeriodsPerYear(job.payPeriod!);
        const taxBracketInput = buildBracketInput(
          bracketRow,
          limitsMap,
          allBrackets,
        );
        // Profile-resolved deductions, then (current job) the What-If's
        // edits — the same arithmetic every deduction goes through.
        const jobDeductions = profileResult.deductions.filter(
          (d) => d.jobId === job.id,
        );
        const deductions: DeductionLine[] = jobDeductions.map((d) =>
          deductionLine(
            d,
            (opts.sandbox ? deductionEditMap.get(d.id) : undefined) ??
              toNumber(String(d.amountPerPeriod)),
          ),
        );
        // Other pay: rows for this job, amounts from its Salary Profile entry.
        const earningLinesForJob = earningLines(
          allEarnings.filter((e) => e.jobId === job.id),
          salaryProfileActiveMap.get(job.id)?.otherEarnings,
        );
        if (opts.sandbox)
          for (const addition of input?.sandboxDeductionAdditions ?? []) {
            if (addition.personId !== person.id) continue;
            deductions.push(
              deductionLine(
                {
                  deductionName: addition.name,
                  isPretax: addition.isPretax,
                  ficaExempt: addition.ficaExempt,
                },
                addition.amountPerPeriod,
              ),
            );
          }
        // The current job: its active contributions plus the person's own.
        // An ended job: every contribution it carried (it can't tell when
        // one was switched off), never the person's own — those belong to
        // the current job's year.
        const jobContribs = effectiveContribs.filter(
          (c) => c.jobId === job.id && (opts.sandbox ? c.isActive : true),
        );
        const personalContribs = opts.sandbox
          ? effectiveContribs.filter(
              (c) =>
                c.jobId === null &&
                c.personId === person.id &&
                c.isActive &&
                c.ownership !== "joint",
            )
          : [];
        const bonusTerms = opts.sandbox
          ? applyActiveBonusTerms(effectiveSalaryMap.get(person.id), comp.terms)
          : comp.terms;
        const contribAccounts = buildContribAccounts(
          jobContribs,
          personalContribs,
          salary,
          periodsPerYear,
          ficaCapContext(limitsRecord, person.dateOfBirth, taxYear),
          contributionPay(salary, bonusTerms, comp.bonusOverride).bonusGross,
        );
        // This year's actual paid-out bonus, if pinned on the Salary
        // Profile entry (SalaryProfileEntry.bonusOverride).
        const paycheckInput = buildPaycheckInputForJob(job, {
          salary,
          bonusTerms,
          bonusOverride: comp.bonusOverride,
          contributionAccounts: contribAccounts,
          deductions,
          earnings: earningLinesForJob,
          taxBrackets: taxBracketInput,
          limitsMap,
          limitsRecord,
          asOfDate: opts.asOf ?? asOfDate,
        });
        return {
          comp,
          salary,
          periodsPerYear,
          taxBracketInput,
          jobDeductions,
          deductions,
          earningLinesForJob,
          jobContribs,
          personalContribs,
          bonusTerms,
          contribAccounts,
          paycheckInput,
        };
      };

      /**
       * A person's jobs that ended this tax year, each for the checks it
       * paid up to its end (its own Salary Profile entry; none of the
       * What-If). Counted whether or not they have a job now — someone laid
       * off or retired mid-year still earned this year. `endedWithheld` is
       * what those checks withheld (federal + FICA, regular checks only, as
       * withheldThroughPeriod). A current job whose last day is later this
       * year isn't one of them (`currentJobId`): it's counted as the
       * current job, up to its last day.
       */
      const endedJobYears = (
        person: (typeof people)[number],
        currentJobId?: number,
      ) => {
        const endedJobs = effectiveJobs.filter(
          (j) =>
            j.personId === person.id &&
            j.id !== currentJobId &&
            !j.isSpeculative &&
            j.endDate != null &&
            Number(String(j.endDate).slice(0, 4)) === taxYear,
        );
        const endedYears = endedJobs.flatMap((job) => {
          const end = new Date(`${String(job.endDate).slice(0, 10)}T12:00:00Z`);
          const ended = jobPaycheckSetup(job, person, {
            sandbox: false,
            asOf: end,
          });
          if (!ended) return [];
          const endedPaycheck = calculatePaycheck(ended.paycheckInput);
          const anchor = job.anchorPayDate ?? job.startDate;
          // Its paydays from the year's start (or its own) to its end.
          const checks = checksPaidYtd(
            end,
            job.payPeriod!,
            anchor,
            ended.periodsPerYear,
            job.startDate,
          );
          const paydaysToEnd = countPeriodsElapsed(
            end,
            job.payPeriod!,
            new Date(anchor),
          );
          return [
            {
              employerName: job.employerName,
              bonusUndated: endedPaycheck.bonusUndated,
              // Withheld so far: its checks to today, or to its end when
              // that's passed (the earnings count to the end either way).
              withheld: withheldThroughPeriod(
                endedPaycheck.yearSchedule,
                Math.min(
                  countPeriodsElapsed(
                    end < asOfDate ? end : asOfDate,
                    job.payPeriod!,
                    new Date(anchor),
                  ),
                  ended.periodsPerYear,
                ),
              ),
              year: computeAnnualEarnings({
                salary: ended.salary,
                periodsPerYear: ended.periodsPerYear,
                paycheck: endedPaycheck,
                contributionAccounts: ended.contribAccounts,
                deductions: ended.deductions,
                checks,
                // Only a bonus dated on or before its last day.
                bonusPaid:
                  endedPaycheck.bonusPeriod !== null &&
                  endedPaycheck.bonusPeriod <= paydaysToEnd,
              }),
            },
          ];
        });
        return {
          endedJobs,
          endedYears: endedYears.map((e) => e.year),
          undatedBonusEmployers: endedYears
            .filter((e) => e.bonusUndated)
            .map((e) => e.employerName),
          endedWithheld: {
            federal: roundToCents(sumBy(endedYears, (e) => e.withheld.federal)),
            fica: roundToCents(sumBy(endedYears, (e) => e.withheld.fica)),
          },
        };
      };

      const results = await Promise.all(
        people.map(async (person) => {
          // Personal (jobless) contributions belong on this person's card
          // whether or not they currently have an active job — computed
          // before the early returns below so neither branch loses the
          // signal.
          const incompleteAccountIds = getIncompleteContribAccountIds(
            allContribs.filter(
              (c) =>
                c.personId === person.id &&
                (c.jobId === null || allJobs.some((j) => j.id === c.jobId)),
            ),
            accountActiveFields,
          );

          // No current job (or an incomplete one): the year's pay is
          // what jobs that ended this year paid — null when none did.
          const endedOnly = () => {
            const { endedYears, endedWithheld, undatedBonusEmployers } =
              endedJobYears(person);
            return {
              earnings:
                endedYears.length > 0 ? sumHouseholdIncome(endedYears) : null,
              endedWithheld,
              bonusNotCounted: undatedBonusEmployers,
            };
          };
          const activeJob = findActiveJob(effectiveJobs, person.id, asOfDate);
          if (!activeJob) {
            // A job that hasn't started: no paycheck yet, and its pay isn't
            // counted until it starts.
            const upcoming = effectiveJobs
              .filter(
                (j) =>
                  j.personId === person.id &&
                  !j.isSpeculative &&
                  String(j.startDate).slice(0, 10) > localDateStr(asOfDate),
              )
              .sort((a, b) =>
                String(a.startDate).localeCompare(String(b.startDate)),
              )[0];
            return {
              person,
              job: null,
              salary: 0,
              paycheck: null,
              upcomingJob: upcoming
                ? {
                    employerName: upcoming.employerName,
                    startDate: String(upcoming.startDate).slice(0, 10),
                  }
                : null,
              ...endedOnly(),
              rawDeductions: [],
              rawContribs: [],
              incompleteAccountIds,
            };
          }
          const jobForClient = activeJob;

          const setup = jobPaycheckSetup(activeJob, person, {
            sandbox: true,
          });
          if (!setup) {
            return {
              person,
              job: jobForClient,
              salary: 0,
              paycheck: null,
              ...endedOnly(),
              rawDeductions: [],
              rawContribs: [],
              incompleteAccountIds,
            };
          }
          const {
            comp,
            salary,
            periodsPerYear,
            taxBracketInput,
            jobDeductions,
            deductions,
            jobContribs,
            personalContribs,
            bonusTerms,
            contribAccounts,
            paycheckInput,
          } = setup;
          const paycheck = calculatePaycheck(paycheckInput);
          // The pay-stub check compares one real check — what payroll
          // actually deducts, the configured amounts — so a person over an
          // IRS limit gets that check figured on the configured rows.
          const configured = <T extends { cappedValue?: number }>(rows: T[]) =>
            rows.map(({ cappedValue: _capped, ...r }) => r);
          const paystubPaycheck = [...jobContribs, ...personalContribs].some(
            (c) => (c.cap?.overBy ?? 0) > 0,
          )
            ? calculatePaycheck({
                ...paycheckInput,
                contributionAccounts: buildContribAccounts(
                  configured(jobContribs),
                  configured(personalContribs),
                  salary,
                  periodsPerYear,
                  ficaCapContext(limitsRecord, person.dateOfBirth, taxYear),
                  contributionPay(salary, bonusTerms, comp.bonusOverride)
                    .bonusGross,
                ),
              })
            : null;
          // The nominal formula figure, ignoring any current-year pin — lets
          // the UI show "target" (formula) alongside "actual" (resolved)
          // instead of only ever showing the resolved value.
          const fullFormulaBonusEstimate =
            paycheckInput.bonusOverride !== null
              ? calculatePaycheck({ ...paycheckInput, bonusOverride: null })
                  .bonusEstimate
              : paycheck.bonusEstimate;

          // Blended annual computation. Salary is a flat number under the
          // active Salary Profile — no mid-year timeline to blend across
          // any more (see resolveCompensation's docblock), so this is
          // always a single segment spanning the whole year; what's left of
          // "blended" is folding in actual YTD performance data below.
          // A last day later this year (the job is still current): its
          // checks inside the year stop there.
          const lastDay =
            activeJob.endDate != null &&
            Number(String(activeJob.endDate).slice(0, 4)) === taxYear
              ? new Date(`${String(activeJob.endDate).slice(0, 10)}T12:00:00Z`)
              : null;
          const anchor = activeJob.anchorPayDate ?? activeJob.startDate;
          let blendedAnnual: BlendedAnnualTotals | null = null;
          {
            const currentYear = taxYear;
            // The checks it pays this year: from its start, to its last day.
            const salarySegments: SalarySegment[] = [
              {
                salary,
                effectiveDate: null,
                startPeriod: 1 + paycheck.periodsBeforeStart,
                endPeriod: lastDay
                  ? Math.min(
                      periodsPerYear,
                      countPeriodsElapsed(
                        lastDay,
                        activeJob.payPeriod!,
                        new Date(anchor),
                      ),
                    )
                  : periodsPerYear,
                paycheck,
              },
            ];

            blendedAnnual = calculateBlendedAnnual(
              salarySegments,
              taxBracketInput,
            );

            // Fetch actual YTD contribution data from account_performance
            const perfActuals = await ctx.db
              .select({
                performanceAccountId:
                  schema.accountPerformance.performanceAccountId,
                totalContributions:
                  schema.accountPerformance.totalContributions,
                employerContributions:
                  schema.accountPerformance.employerContributions,
              })
              .from(schema.accountPerformance)
              .where(eq(schema.accountPerformance.year, currentYear));

            // Sum actuals that link to this person's contribution accounts
            const personPerfAccountIds = new Set(
              jobContribs
                .map((c) => c.performanceAccountId)
                .filter(Boolean) as number[],
            );
            let actualContribs = 0;
            let actualMatch = 0;
            for (const row of perfActuals) {
              if (
                row.performanceAccountId &&
                personPerfAccountIds.has(row.performanceAccountId)
              ) {
                actualContribs += toNumber(row.totalContributions);
                actualMatch += toNumber(row.employerContributions);
              }
            }

            // Attach actuals if any matching performance data was found
            if (personPerfAccountIds.size > 0 && perfActuals.length > 0) {
              blendedAnnual.actualYtdContributions = actualContribs;
              blendedAnnual.actualYtdEmployerMatch = actualMatch;
            }
          }

          // This person's year: salary + the resolved bonus, pre-tax money
          // and FICA wages — what the household tax and every income
          // figure read (household annual income, DESIGN.md).
          // This person's year: every job they had in it, each for the
          // checks it pays inside the year — the current job from its
          // start (to its last day when that's later this year), plus any
          // job that ended this year (household-income.ts).
          const currentJobYear = computeAnnualEarnings({
            salary,
            periodsPerYear,
            paycheck,
            contributionAccounts: contribAccounts,
            deductions,
            checks: lastDay
              ? checksPaidYtd(
                  lastDay,
                  activeJob.payPeriod!,
                  anchor,
                  periodsPerYear,
                  activeJob.startDate,
                )
              : periodsPerYear - paycheck.periodsBeforeStart,
            bonusPaid:
              !paycheck.bonusBeforeStart &&
              (lastDay === null ||
                (paycheck.bonusPeriod !== null &&
                  paycheck.bonusPeriod <=
                    countPeriodsElapsed(
                      lastDay,
                      activeJob.payPeriod!,
                      new Date(anchor),
                    ))),
          });
          const {
            endedJobs,
            endedYears,
            endedWithheld,
            undatedBonusEmployers,
          } = endedJobYears(person, activeJob.id);
          // A job leaving this year whose bonus has no date: whether it's
          // paid before the last day isn't known, so it isn't counted.
          const bonusNotCounted = [
            ...(lastDay && paycheck.bonusUndated
              ? [activeJob.employerName]
              : []),
            ...undatedBonusEmployers,
          ];
          const earnings =
            endedYears.length > 0
              ? sumHouseholdIncome([currentJobYear, ...endedYears])
              : currentJobYear;
          // A job started this year with no earlier job counted: its pay
          // before the start isn't in Ledgr.
          const start = String(activeJob.startDate).slice(0, 10);
          const yearPayNote =
            paycheck.periodsBeforeStart > 0 && endedYears.length === 0
              ? {
                  startDate: start,
                  missingEndedJob: endedJobs.length > 0,
                }
              : null;

          const rawContribs = [...jobContribs, ...personalContribs];
          const budgetOverride = activeJob.budgetPeriodsPerMonth ?? null;

          return {
            person,
            job: jobForClient,
            salary,
            /** Set when this person's year starts with the current job:
             *  pay before `startDate` isn't counted (no earlier job in
             *  Ledgr, or — missingEndedJob — one whose Salary Profile entry
             *  is incomplete). */
            yearPayNote,
            /** Employers of jobs ending this tax year whose bonus has no
             *  date — left out of this year's income (it may be paid
             *  after the last day). */
            bonusNotCounted,
            /** The bonus terms actually in effect (the active Salary
             *  Profile's resolved terms, with the What-If sandbox's own
             *  edits layered on top — never a job fallback, jobs carry no
             *  bonus terms of their own any more) — as numbers, for clients
             *  (e.g. the What-If tab's editor) that need to pre-fill from
             *  the resolved value rather than `job`'s raw, profile-unaware
             *  fields. Mirrors what `salary` already does for the salary
             *  axis. */
            resolvedBonusTerms: {
              bonusPercent: toNumber(bonusTerms.bonusPercent),
              bonusMultiplier:
                bonusTerms.bonusMultiplier === null
                  ? 1
                  : toNumber(bonusTerms.bonusMultiplier),
              monthsInBonusYear: bonusTerms.monthsInBonusYear ?? 12,
              bonusOverride: comp.bonusOverride,
            },
            paycheck,
            /** The paycheck on the configured contributions, for the
             *  pay-stub check — null when nothing is capped (same as
             *  `paycheck`). */
            paystubPaycheck,
            fullFormulaBonusEstimate,
            blendedAnnual,
            earnings,
            /** What jobs that ended this year withheld (federal + FICA) —
             *  added to the current job's withholding so far. */
            endedWithheld,
            rawDeductions: jobDeductions,
            /** This job's other-pay lines with their per-check amount from
             *  the Salary Profile entry (0 when it sets none). */
            earningRows: allEarnings
              .filter((e) => e.jobId === activeJob.id)
              .map((e) => ({
                ...e,
                amount:
                  salaryProfileActiveMap.get(activeJob.id)?.otherEarnings?.[
                    String(e.id)
                  ] ?? 0,
              })),
            rawContribs,
            /** The year's Social Security / Medicare rates, wage base and
             *  Additional Medicare withholding threshold — what
             *  "Check against your pay stub" works back from (tax data,
             *  never hard-coded). */
            ficaRates: {
              socialSecurity: taxBracketInput.socialSecurityRate,
              medicare: taxBracketInput.medicareRate,
              socialSecurityWageBase: taxBracketInput.socialSecurityWageBase,
              medicareWithholdingThreshold:
                taxBracketInput.medicareAdditionalThreshold,
              additionalMedicare: taxBracketInput.medicareAdditionalRate,
            },
            /** Where this job's bonus goes (its Salary Profile entry;
             *  absent = the budget). */
            bonusDestination:
              salaryProfileActiveMap.get(activeJob.id)?.bonusDestination ??
              DEFAULT_BONUS_DESTINATION,
            /** The accounts the bonus check takes, and how much — the
             *  accounts set to be taken from bonus checks (fromBonus). */
            bonusCheckAccounts: contribAccounts.flatMap((a) => {
              const amount = bonusCheckContribution(
                a,
                paycheck.bonusEstimate.bonusGross,
              );
              return a.id !== undefined && amount > 0
                ? [{ id: a.id, amount }]
                : [];
            }),
            budgetPerMonth: getRegularPeriodsPerMonth(
              periodsPerYear,
              budgetOverride,
            ),
            budgetNote: getBudgetFrequencyNote(
              activeJob.payPeriod!,
              budgetOverride,
            ),
            incompleteAccountIds,
          };
        }),
      );

      // Joint accounts — returned separately for household-level display
      const jointContribs = effectiveContribs.filter(
        (c) => c.isActive && c.ownership === "joint",
      );

      // Household annual income and tax. Federal on the combined income
      // with ONE standard deduction; FICA per person on FICA wages;
      // Additional Medicare on the household's combined Medicare wages
      // above the filing status's liability threshold.
      // Everyone with pay this year — a current job, or one that ended.
      const earners = results.filter((r) => r.earnings);
      const householdIncome =
        earners.length > 0
          ? sumHouseholdIncome(earners.map((r) => r.earnings!))
          : null;
      // The household's tax-return filing status — the one the caps use
      // (loadCapHousehold), never a W-4 on its own: a W-4 status is a
      // withholding choice (married couples often pick Single).
      const householdFilingStatus = capHousehold.filingStatus || null;
      let householdTax = null;
      if (earners.length > 0 && householdFilingStatus) {
        const filingStatus = householdFilingStatus;
        const bracketRow = allBrackets.find(
          (b) => b.filingStatus === filingStatus && b.w4Checkbox === false,
        );
        if (bracketRow) {
          householdTax = calculateHouseholdTax({
            people: earners.map((r) => r.earnings!),
            taxBrackets: buildLiabilityBracketInput(bracketRow, limitsMap),
            medicareLiabilityThreshold:
              limitsRecord[medicareLiabilityKey(filingStatus)] ?? null,
          });
        }
      }

      const rothIra = rothIraSummary({
        // No one with a job → no Roth IRA view, as before.
        filingStatus: earners.length > 0 ? householdFilingStatus : null,
        taxYear,
        limits: limitsRecord,
        people: results.map((r) => ({
          personId: r.person.id,
          name: r.person.name,
          birthYear: Number(r.person.dateOfBirth.slice(0, 4)),
          earnings: r.earnings,
          jobAccountTypes: r.rawContribs
            .filter((c) => c.jobId !== null)
            .map((c) => c.accountType),
          iraRoom:
            r.rawContribs.find((c) => isIraCategory(c.accountType) && c.cap)
              ?.cap?.maxEmployee ?? null,
          rothRoute: rothIraRouteOf(r.rawContribs),
        })),
      });

      // Default cash to keep in each person's HSA: the year's HDHP minimum
      // deductible for their coverage (from their HSA contribution account).
      const hsaBuffers = hsaCashBuffers({
        limits: limitsRecord,
        people: results.map((r) => ({
          personId: r.person.id,
          hsaCoverageType:
            r.rawContribs.find(
              (c) => isHsaCategory(c.accountType) && c.hsaCoverageType,
            )?.hsaCoverageType ?? null,
        })),
      });

      return {
        people: results,
        jointContribs,
        householdIncome,
        householdTax,
        /** The tax-return filing status the household tax was figured for
         *  (null: none set and no W-4 to stand in). */
        filingStatus: householdFilingStatus,
        /** Where it came from: the household setting, the active
         *  Retirement Profile, or a W-4 standing in. */
        filingStatusSource: householdFilingStatus
          ? capHousehold.filingStatusSource
          : null,
        rothIra,
        hsaBuffers,
        // The tax-data vintage this summary was priced under — for a
        // "Tax data: YYYY" indicator, matching the retirement projection side.
        taxYear,
        taxParamsVersion: resolvedTax?.version ?? 0,
      };
    }),
});
