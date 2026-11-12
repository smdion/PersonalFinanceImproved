/** The paycheck summary (paycheck.computeSummary). Its input: the profile
 *  pair and tax year it prices under, and the What-If tab's edits. */
import { z } from "zod/v4";
import {
  zSandboxSalaryEntries,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { loadCapHousehold } from "@/server/services/contributions/caps";
import { capForRequest } from "@/lib/pure/contributions/cap-request";
import { DEFAULT_BONUS_DESTINATION } from "@/lib/config/enum-values";
import { eq } from "drizzle-orm";
import { roundToCents, sumBy } from "@/lib/utils/math";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { bonusCheckContribution } from "@/lib/pure/paycheck/bonus";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import {
  checksPaidYtd,
  countPeriodsElapsed,
} from "@/lib/pure/paycheck/pay-periods-in-year";
import { withheldThroughPeriod } from "@/lib/pure/paycheck/year-schedule";
import {
  getRegularPeriodsPerMonth,
  getBudgetFrequencyNote,
} from "@/lib/pure/paycheck/budget-periods";
import {
  buildPaycheckInputForJob,
  jobScheduleDates,
} from "@/lib/pure/paycheck/paycheck-input";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { loadAndApplyContribProfile } from "@/server/services/contributions/profile";
import { applyContribActiveFields } from "@/server/services/contributions/profile";
import { buildSandboxContribRow } from "@/server/services/contributions/profile";
import { fetchContributionProfile } from "@/server/services/contributions/profile";
import { buildContribAccounts } from "@/lib/pure/contributions/paycheck-accounts";
import { isHouseholdJointRow } from "@/lib/pure/contributions/contribution-rows";
import { getIncompleteContribAccountIds } from "@/lib/pure/contributions/profile-fields";
import { toNumber } from "@/lib/utils/numbers";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { getAllPeople } from "@/server/data/people";
import {
  applySandboxSalaryEntries,
  resolveCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  contributionPay,
} from "@/lib/pure/household/compensation";
import type { DeductionLine } from "@/lib/pure/paycheck/paycheck.types";
import {
  computeAnnualEarnings,
  sumHouseholdIncome,
} from "@/lib/pure/household/household-income";
import {
  deductionLine,
  earningLines,
} from "@/lib/pure/paycheck/paycheck-lines";
import { findActiveJob, otherCurrentJobs } from "@/lib/pure/household/profiles";
import { resolveTaxParams } from "@/lib/pure/tax/resolve-tax-params";
import { ficaCapContext } from "@/lib/pure/contributions/irs-limits";
import { buildBracketInput } from "@/lib/pure/paycheck/withholding";
import { householdTotals } from "@/server/services/paycheck/household-totals";
import {
  checkPaychecks,
  yearEarnings,
} from "@/lib/pure/paycheck/person-paycheck";

export const zPaycheckSummaryInput = z
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
  .optional();

export async function computePaycheckSummary(
  ctx: { db: Db; scope: RequestScope },
  input: z.output<typeof zPaycheckSummaryInput>,
) {
  const deductionEditMap = new Map(
    (input?.sandboxDeductionEdits ?? []).map((e) => [e.id, e.amountPerPeriod]),
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
    ctx.scope.load(getAllPeople),
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

  // Same resolver as the retirement engine, but "null" on a missing year: the
  // year selector can pick a year with no seeded tables, which shows empty, never
  // another year's figures. `taxYearOverride` undefined => newest enacted year.
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
    ctx.scope.asOf.getFullYear();
  const allBrackets = resolvedTax
    ? allBracketRows.filter((b) => b.taxYear === resolvedTax.resolvedYear)
    : [];

  const limitsRecord: Record<string, number> = resolvedTax?.limits ?? {};
  const limitsMap = new Map<string, number>(Object.entries(limitsRecord));

  // Salaries: the What-If sandbox first, then the Salary Profile (no
  // salaryProfileId = the active one). The Contribution Profile sets no salary,
  // only account/job fields.
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
  // Accounts with no active value under this profile (applyContribActiveFields
  // excludes them) are surfaced per person, so a card never shows a quietly
  // shrunk total.
  const contribProfileRow = await fetchContributionProfile(
    ctx.db,
    input?.contributionProfileId,
  );
  const accountActiveFields = contribProfileRow
    ? readContributionActiveFields(
        contribProfileRow.contributionActiveFields,
        contribProfileRow.id,
      ).contributionAccounts
    : {};
  // The What-If tab's sandbox edits apply last, through the same merge
  // function: one more layer, never a second resolution path.
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
  const asOfDate = ctx.scope.asOf;
  // The IRS-limit cap pass: every figure below reads the capped value.
  const capHousehold = await loadCapHousehold(
    ctx.db,
    people,
    limitsRecord,
    asOfDate,
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
   * One job's paycheck inputs (W-4, Salary Profile salary/bonus, deductions, other pay,
   * contributions), current or ended this year. `sandbox`: apply the What-If (current job only).
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
    // The current job: its active contributions plus the person's own. An ended
    // job: every contribution it carried (it can't tell when one was switched
    // off), never the person's own.
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
    // Profile entry (SalaryEntry.bonusOverride).
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
   * A person's jobs that ended this tax year (with or without a job now), each paid to its end
   * from its own Salary Profile entry, no What-If. `endedWithheld`: their federal + FICA withheld.
   * `currentJobId` is excluded: the current job is counted as current, up to its last day.
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
      const anchor = jobScheduleDates(job).anchorPayDate;
      // Its paydays from the year's start (or its own) to its end.
      const checks = checksPaidYtd(
        end,
        job.payPeriod!,
        anchor,
        ended.periodsPerYear,
        job.startDate,
      );
      const paydaysToEnd = countPeriodsElapsed(end, job.payPeriod!, anchor);
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
                anchor,
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
      // Personal (jobless) contributions show with or without a job: before the early returns.
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
              String(j.startDate).slice(0, 10) > calendarDateOf(asOfDate),
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
      const { paycheck, paystubPaycheck, fullFormulaBonusEstimate } =
        checkPaychecks(
          paycheckInput,
          jobContribs,
          personalContribs,
          salary,
          periodsPerYear,
          limitsRecord,
          person,
          taxYear,
          bonusTerms,
          comp,
        );
      const {
        blendedAnnual,
        earnings,
        endedWithheld,
        bonusNotCounted,
        yearPayNote,
      } = yearEarnings(
        activeJob,
        paycheck,
        periodsPerYear,
        salary,
        contribAccounts,
        deductions,
        endedJobYears,
        person,
      );

      const rawContribs = [...jobContribs, ...personalContribs];
      const budgetOverride = activeJob.budgetPeriodsPerMonth ?? null;

      return {
        person,
        job: jobForClient,
        salary,
        /** Set when this person's year starts with the current job: pay before
         *  `startDate` isn't counted (no earlier job, or missingEndedJob). */
        yearPayNote,
        /** Employers of jobs ending this tax year whose bonus has no
         *  date — left out of this year's income (it may be paid
         *  after the last day). */
        bonusNotCounted,
        /** Bonus terms in effect (the active Salary Profile's, with the What-If's
         *  edits on top), as numbers, for clients that pre-fill from the resolved
         *  value rather than `job`'s profile-unaware fields. */
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
        otherCurrentJobs: otherCurrentJobs(effectiveJobs, activeJob, asOfDate),
        /** The year's Social Security / Medicare rates, wage base and Additional
         *  Medicare threshold, from tax data: what "Check against your pay stub"
         *  works back from. */
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
          return a.id !== undefined && amount > 0 ? [{ id: a.id, amount }] : [];
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

  const jointContribs = effectiveContribs.filter(
    (c) => c.isActive && isHouseholdJointRow(c),
  );
  const {
    householdIncome,
    householdFilingStatus,
    householdTax,
    rothIra,
    hsaBuffers,
  } = householdTotals(
    results,
    capHousehold,
    allBrackets,
    limitsMap,
    limitsRecord,
    taxYear,
  );

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
}
