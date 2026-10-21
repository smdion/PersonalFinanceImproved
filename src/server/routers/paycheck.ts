/** Paycheck router for gross-to-net pay calculations including federal/state tax withholding, pre-tax deductions, and per-period contribution breakdowns. */
import { DEFAULT_BONUS_DESTINATION } from "@/lib/config/enum-values";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  bonusCheckContribution,
  calculatePaycheck,
  calculateBlendedAnnual,
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
import { rothIraSummary } from "@/lib/pure/roth-ira";
import { deductionLine, earningLines } from "@/lib/pure/paycheck-lines";
import { medicareLiabilityKey } from "@/lib/config/tax-params";
import { hsaCashBuffers } from "@/lib/pure/cash-positions";
import { isHsaCategory } from "@/lib/config/account-types";
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
      const effectiveContribs = applyContribActiveFields(
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
        effectiveContribs.push(buildSandboxContribRow(addition, -(i + 1)));
      }
      const effectiveJobs = profileResult.jobs;

      const asOfDate = new Date();

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

          const activeJob = findActiveJob(effectiveJobs, person.id);
          if (!activeJob) {
            return {
              person,
              job: null,
              salary: 0,
              paycheck: null,
              earnings: null,
              rawDeductions: [],
              rawContribs: [],
              incompleteAccountIds,
            };
          }
          const jobForClient = activeJob;

          // activeJob.w4FilingStatus is undefined both when this job has no
          // entry in the active Salary Profile at all, and (structurally
          // impossible otherwise, since an entry is always complete —
          // see mergeSalaryProfileJobFields) when it does. Either way, no
          // bracketRow match means "incomplete," the same safe state a
          // job with no Salary Profile entry already resolves to.
          const bracketRow = allBrackets.find(
            (b) =>
              b.filingStatus === activeJob.w4FilingStatus &&
              b.w4Checkbox === activeJob.w4Box2cChecked,
          );
          if (!bracketRow) {
            return {
              person,
              job: jobForClient,
              salary: 0,
              paycheck: null,
              earnings: null,
              rawDeductions: [],
              rawContribs: [],
              incompleteAccountIds,
            };
          }
          // From here on, activeJob's Salary Profile fields are guaranteed
          // present — bracketRow only matched because w4FilingStatus/
          // w4Box2cChecked were defined, which only happens for a complete
          // entry (all 16 fields present together).

          // A job has no salary/bonus of its own — resolve against the
          // Salary Profile, then the What-If sandbox.
          const comp = resolveCompensation(
            salaryProfileActiveMap,
            activeJob.id,
          );
          const dbSalary = comp.salary;
          const salary = applyActiveSalary(
            person.id,
            dbSalary,
            effectiveSalaryMap,
          );
          const periodsPerYear = getPeriodsPerYear(activeJob.payPeriod!);
          const taxBracketInput = buildBracketInput(
            bracketRow,
            limitsMap,
            allBrackets,
          );

          // profileResult.deductions is already profile-resolved (live
          // default, patched by any active-field value the profile sets) —
          // the What-If sandbox edit below layers on top of THAT, same
          // profile-then-sandbox precedence contribution accounts already
          // use (applyContribActiveFields's isOverlay pass above).
          const jobDeductions = profileResult.deductions.filter(
            (d) => d.jobId === activeJob.id,
          );
          const deductions: DeductionLine[] = jobDeductions.map((d) =>
            // A sandbox edit is one more layer on top of the profile-
            // resolved amount, applied here (not a second pass after
            // calculatePaycheck) so it's the SAME arithmetic every other
            // deduction goes through.
            deductionLine(
              d,
              deductionEditMap.get(d.id) ?? toNumber(String(d.amountPerPeriod)),
            ),
          );
          // Other pay: rows for this job, amounts from its Salary Profile
          // entry (the same axis as salary and bonus).
          const earningLinesForJob = earningLines(
            allEarnings.filter((e) => e.jobId === activeJob.id),
            salaryProfileActiveMap.get(activeJob.id)?.otherEarnings,
          );
          // Hypothetical additions have no DB row — appended for the
          // duration of this request only, never written anywhere.
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

          const jobContribs = effectiveContribs.filter(
            (c) => c.jobId === activeJob.id && c.isActive,
          );
          const personalContribs = effectiveContribs.filter(
            (c) =>
              c.jobId === null &&
              c.personId === person.id &&
              c.isActive &&
              c.ownership !== "joint",
          );
          // The What-If sandbox can override bonus terms independently of
          // salary — same per-field precedence as the salary merge above.
          const personBonusEntry = effectiveSalaryMap.get(person.id);
          const bonusTerms = applyActiveBonusTerms(
            personBonusEntry,
            comp.terms,
          );
          const contribAccounts = buildContribAccounts(
            jobContribs,
            personalContribs,
            salary,
            periodsPerYear,
            ficaCapContext(limitsRecord, person.dateOfBirth, taxYear),
            contributionPay(salary, bonusTerms, comp.bonusOverride).bonusGross,
          );

          // This year's actual paid-out bonus, if pinned on the Salary
          // Profile entry — see SalaryProfileEntry.bonusOverride's
          // docblock. Never flows into growth/projection math; only this
          // live paycheck display reads it.
          const paycheckInput = buildPaycheckInputForJob(activeJob, {
            salary,
            bonusTerms,
            bonusOverride: comp.bonusOverride,
            contributionAccounts: contribAccounts,
            deductions,
            earnings: earningLinesForJob,
            taxBrackets: taxBracketInput,
            limitsMap,
            limitsRecord,
            asOfDate,
          });

          const paycheck = calculatePaycheck(paycheckInput);
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
          let blendedAnnual: BlendedAnnualTotals | null = null;
          {
            const currentYear = taxYear;
            const salarySegments: SalarySegment[] = [
              {
                salary,
                effectiveDate: null,
                startPeriod: 1,
                endPeriod: periodsPerYear,
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
          const earnings = computeAnnualEarnings({
            salary,
            periodsPerYear,
            paycheck,
            contributionAccounts: contribAccounts,
            deductions,
          });

          const rawContribs = [...jobContribs, ...personalContribs];
          const budgetOverride = activeJob.budgetPeriodsPerMonth ?? null;

          return {
            person,
            job: jobForClient,
            salary,
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
            fullFormulaBonusEstimate,
            blendedAnnual,
            earnings,
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
      const earners = results.filter((r) => r.paycheck && r.earnings && r.job);
      const householdIncome =
        earners.length > 0
          ? sumHouseholdIncome(earners.map((r) => r.earnings!))
          : null;
      let householdTax = null;
      if (earners.length > 0) {
        const filingStatus = earners[0]!.job!.w4FilingStatus!;
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
        filingStatus: earners[0]?.job?.w4FilingStatus ?? null,
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
        rothIra,
        hsaBuffers,
        // The tax-data vintage this summary was priced under — for a
        // "Tax data: YYYY" indicator, matching the retirement projection side.
        taxYear,
        taxParamsVersion: resolvedTax?.version ?? 0,
      };
    }),
});
