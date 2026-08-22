/** Paycheck router for gross-to-net pay calculations including federal/state tax withholding, pre-tax deductions, and per-period contribution breakdowns. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  calculatePaycheck,
  calculateBlendedAnnual,
} from "@/lib/calculators/paycheck";
import type { SalarySegment } from "@/lib/calculators/paycheck";
import { calculateTax } from "@/lib/calculators/tax";
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
} from "@/server/helpers";
import { applySandboxSalaryEntries } from "@/server/helpers/salary";
import {
  toSalaryActiveMap,
  zSandboxSalaryEntries,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "./_shared";
import type {
  DeductionLine,
  TaxBracketInput,
  TaxInput,
  BlendedAnnualTotals,
} from "@/lib/calculators/types";
import { computeHouseholdTax } from "@/lib/pure/tax";
import { findActiveJob } from "@/lib/pure/profiles";

/** Build TaxBracketInput from DB bracket row + limits. */
export function buildBracketInput(
  bracketRow: typeof schema.taxBrackets.$inferSelect,
  limits: Map<string, number>,
): TaxBracketInput {
  const brackets = bracketRow.brackets.map((b, i, arr) => ({
    min: b.threshold,
    max: i < arr.length - 1 ? arr[i + 1]!.threshold : null,
    rate: b.rate,
  }));

  return {
    filingStatus: bracketRow.filingStatus,
    w4Checkbox: bracketRow.w4Checkbox,
    brackets,
    standardDeduction: requireLimit(
      limits,
      `standard_deduction_${bracketRow.filingStatus.toLowerCase()}`,
    ),
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

export const paycheckRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(
      z
        .object({
          salaryActiveFields: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          taxYearOverride: z.number().int().optional(),
          contributionProfileId: z.number().int().optional(),
          salaryProfileId: z.number().int().optional(),
          /** The What-If tab's hand-edited salary/bonus entries — highest
           *  precedence tier, above Plan/session overrides and the Salary
           *  Profile pin. See applySandboxSalaryEntries. */
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
      const salaryActiveMap = toSalaryActiveMap(input?.salaryActiveFields);
      const deductionEditMap = new Map(
        (input?.sandboxDeductionEdits ?? []).map((e) => [
          e.id,
          e.amountPerPeriod,
        ]),
      );
      const taxYear = input?.taxYearOverride ?? new Date().getFullYear();
      const [
        people,
        allJobs,
        allDeductions,
        allContribs,
        allLimits,
        allBrackets,
      ] = await Promise.all([
        ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
        ctx.db.select().from(schema.jobs),
        ctx.db.select().from(schema.paycheckDeductions),
        ctx.db
          .select()
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.isActive, true)),
        ctx.db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.taxYear, taxYear)),
        ctx.db
          .select()
          .from(schema.taxBrackets)
          .where(eq(schema.taxBrackets.taxYear, taxYear)),
      ]);

      const limitsMap = new Map<string, number>();
      for (const l of allLimits) limitsMap.set(l.limitType, toNumber(l.value));

      const limitsRecord: Record<string, number> = {};
      for (const l of allLimits) limitsRecord[l.limitType] = toNumber(l.value);

      // Salary and contribution overrides are two independent axes.
      // Precedence for salary: Plan/session overrides (already in the map,
      // highest) > Salary Profile. The Contribution Profile contributes no
      // salary at all — only account/job field overrides. No explicit
      // salaryProfileId falls back to the globally-active profile.
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
              tax: null,
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
              tax: null,
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
          // Salary Profile, then the Plan/session + What-If sandbox tiers.
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
          const taxBracketInput = buildBracketInput(bracketRow, limitsMap);

          // profileResult.deductions is already profile-resolved (live
          // default, patched by any active-field value the profile sets) —
          // the What-If sandbox edit below layers on top of THAT, same
          // profile-then-sandbox precedence contribution accounts already
          // use (applyContribActiveFields's isOverlay pass above).
          const jobDeductions = profileResult.deductions.filter(
            (d) => d.jobId === activeJob.id,
          );
          const deductions: DeductionLine[] = jobDeductions.map((d) => ({
            name: d.deductionName,
            // A sandbox edit is one more layer on top of the profile-
            // resolved amount, applied here (not a second pass after
            // calculatePaycheck) so it's the SAME arithmetic every other
            // deduction goes through.
            amount:
              deductionEditMap.get(d.id) ?? toNumber(String(d.amountPerPeriod)),
            taxTreatment: d.isPretax
              ? ("pre_tax" as const)
              : ("after_tax" as const),
            ficaExempt: d.ficaExempt,
          }));
          // Hypothetical additions have no DB row — appended for the
          // duration of this request only, never written anywhere.
          for (const addition of input?.sandboxDeductionAdditions ?? []) {
            if (addition.personId !== person.id) continue;
            deductions.push({
              name: addition.name,
              amount: addition.amountPerPeriod,
              taxTreatment: addition.isPretax ? "pre_tax" : "after_tax",
              ficaExempt: false,
            });
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
          const contribAccounts = buildContribAccounts(
            jobContribs,
            personalContribs,
            salary,
            periodsPerYear,
          );

          // The What-If sandbox can override bonus terms independently of
          // salary — same per-field precedence as the salary merge above.
          const personBonusEntry = effectiveSalaryMap.get(person.id);
          const bonusTerms = applyActiveBonusTerms(
            personBonusEntry,
            comp.terms,
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

          // Annual tax estimate using non-checkbox brackets
          const annualBracketRow = allBrackets.find(
            (b) =>
              b.filingStatus === activeJob.w4FilingStatus &&
              b.w4Checkbox === false,
          );

          let tax = null;
          if (annualBracketRow) {
            const annualBracketInput = buildBracketInput(
              annualBracketRow,
              limitsMap,
            );
            const preTaxAnnual =
              paycheck.preTaxDeductions.reduce((s, d) => s + d.amount, 0) *
              periodsPerYear;
            const taxInput: TaxInput = {
              annualGross: salary,
              preTaxDeductionsAnnual: preTaxAnnual,
              filingStatus: activeJob.w4FilingStatus!,
              taxBrackets: annualBracketInput,
              w4CheckboxOverride: null,
              asOfDate,
            };
            tax = calculateTax(taxInput);
          }

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
            tax,
            rawDeductions: jobDeductions,
            rawContribs,
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

      // Household-level tax calculation for MFJ filers.
      // Per-person calculateTax gives each person the full MFJ standard deduction,
      // which double-counts it. The correct approach: combine all incomes, apply
      // ONE standard deduction, walk brackets once for federal. FICA stays per-person.
      const activePeople = results.filter((r) => r.paycheck && r.tax && r.job);
      let householdTax = null;
      if (activePeople.length > 0) {
        const filingStatus = activePeople[0]!.job!.w4FilingStatus!;
        const bracketRow = allBrackets.find(
          (b) => b.filingStatus === filingStatus && b.w4Checkbox === false,
        );
        if (bracketRow) {
          const bracketInput = buildBracketInput(bracketRow, limitsMap);
          const combinedGross = activePeople.reduce((s, r) => s + r.salary, 0);
          const combinedPreTax = activePeople.reduce((s, r) => {
            const ppy = getPeriodsPerYear(r.job!.payPeriod!);
            return (
              s +
              r.paycheck!.preTaxDeductions.reduce((ss, d) => ss + d.amount, 0) *
                ppy
            );
          }, 0);
          const combinedTax = calculateTax({
            annualGross: combinedGross,
            preTaxDeductionsAnnual: combinedPreTax,
            filingStatus,
            taxBrackets: bracketInput,
            w4CheckboxOverride: null,
            asOfDate,
          });
          // Use combined federal tax but per-person FICA (each has own SS wage base cap)
          householdTax = computeHouseholdTax(
            activePeople.map((r) => ({
              salary: r.salary,
              preTaxDeductionsAnnual: 0, // already factored into combinedTax
              ficaSS: r.tax?.ficaSS ?? 0,
              ficaMedicare: r.tax?.ficaMedicare ?? 0,
            })),
            combinedTax,
          );
        }
      }

      return { people: results, jointContribs, householdTax };
    }),
});
