/** Paycheck router for gross-to-net pay calculations including federal/state tax withholding, pre-tax deductions, and per-period contribution breakdowns. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  calculatePaycheck,
  mapSalaryTimelineToPeriods,
  calculateBlendedAnnual,
} from "@/lib/calculators/paycheck";
import type { SalarySegment } from "@/lib/calculators/paycheck";
import { calculateTax } from "@/lib/calculators/tax";
import {
  toNumber,
  getPeriodsPerYear,
  getRegularPeriodsPerMonth,
  getBudgetFrequencyNote,
  getCurrentSalary,
  getFutureSalaryChanges,
  getBonusOverridesForJobs,
  buildContribAccounts,
  requireLimit,
  loadAndApplyContribProfile,
  loadAndApplySalaryProfile,
  applySalaryOverride,
  resolveBonusTerms,
  applyContribActiveFields,
  buildSandboxContribRow,
} from "@/server/helpers";
import {
  getSalaryTimelineForYear,
  applySandboxSalaryEntries,
} from "@/server/helpers/salary";
import {
  toSalaryOverrideMap,
  zSandboxSalaryEntries,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribOverrides,
  zSandboxContribAdditions,
} from "./_shared";
import type {
  PaycheckInput,
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
          salaryOverrides: z
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
          sandboxContribOverrides: zSandboxContribOverrides,
          /** The What-If tab's hand-added hypothetical contribution
           *  accounts — no DB row, personId-keyed. */
          sandboxContribAdditions: zSandboxContribAdditions,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const salaryOverrideMap = toSalaryOverrideMap(input?.salaryOverrides);
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
      // highest) > Salary Profile > live DB salary. The Contribution Profile
      // contributes no salary at all — only account/job field overrides.
      const effectiveSalaryMap = applySandboxSalaryEntries(
        input?.sandboxSalaryEntries,
        await loadAndApplySalaryProfile(
          ctx.db,
          input?.salaryProfileId,
          salaryOverrideMap,
        ),
      );
      const profileResult = await loadAndApplyContribProfile(
        ctx.db,
        input?.contributionProfileId,
        allContribs,
        allJobs,
      );
      // The What-If tab's sandbox edits are the highest-precedence tier,
      // applied AFTER the picked profile's own overrides — same merge
      // function, one more layer, never a second resolution path.
      const effectiveContribs = applyContribActiveFields(
        profileResult.contribs,
        input?.sandboxContribOverrides ?? {},
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
      const bonusOverrides = await getBonusOverridesForJobs(
        ctx.db,
        effectiveJobs.map((j) => j.id),
      );
      const asOfYear = asOfDate.getFullYear();

      // Use Promise.all since getCurrentSalary is async
      const results = await Promise.all(
        people.map(async (person) => {
          const activeJob = findActiveJob(effectiveJobs, person.id);
          if (!activeJob) {
            return {
              person,
              job: null,
              salary: 0,
              futureSalaryChanges: [],
              paycheck: null,
              tax: null,
              rawDeductions: [],
              rawContribs: [],
            };
          }
          // Synthesized display field — not a DB column — so existing UI
          // plumbing can keep reading job.bonusOverride as "this year's
          // pinned bonus, if any" without knowing about the year-scoped
          // job_bonus_overrides table underneath.
          const resolvedBonusOverrideForClient =
            bonusOverrides.get(`${activeJob.id}:${asOfYear}`) ?? null;
          const jobForClient = {
            ...activeJob,
            bonusOverride:
              resolvedBonusOverrideForClient !== null
                ? resolvedBonusOverrideForClient.toFixed(2)
                : null,
          };

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
              futureSalaryChanges: [],
              paycheck: null,
              tax: null,
              rawDeductions: [],
              rawContribs: [],
            };
          }

          const futureSalaryChanges = await getFutureSalaryChanges(
            ctx.db,
            activeJob.id,
            asOfDate,
          );
          // Plan/Salary-Profile override wins, else current salary
          // from salary_changes (falls back to job starting salary).
          const overrideSalary = effectiveSalaryMap.get(person.id);
          const dbSalary = await getCurrentSalary(
            ctx.db,
            activeJob.id,
            activeJob.annualSalary,
            asOfDate,
          );
          const salary = applySalaryOverride(
            person.id,
            dbSalary,
            effectiveSalaryMap,
          );
          const periodsPerYear = getPeriodsPerYear(activeJob.payPeriod);
          const taxBracketInput = buildBracketInput(bracketRow, limitsMap);

          const jobDeductions = allDeductions.filter(
            (d) => d.jobId === activeJob.id,
          );
          const deductions: DeductionLine[] = jobDeductions.map((d) => ({
            name: d.deductionName,
            // A sandbox edit is one more layer on top of the stored
            // amount, applied here (not a second pass after
            // calculatePaycheck) so it's the SAME arithmetic every other
            // deduction goes through.
            amount: deductionEditMap.get(d.id) ?? toNumber(d.amountPerPeriod),
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

          // A Salary Profile pin on bonus terms is independent of a salary
          // pin — resolveBonusTerms overlays whichever of bonusPercent/
          // bonusMultiplier/monthsInBonusYear the profile pins onto the
          // job's live values, same as resolveCompensation does for the
          // Salary Profile editor. Reading activeJob's raw fields here
          // silently ignored a pinned bonus for a pinned-or-unpinned salary
          // alike.
          const bonusTerms = resolveBonusTerms(activeJob, overrideSalary);

          const paycheckInput: PaycheckInput = {
            annualSalary: salary,
            payPeriod: activeJob.payPeriod,
            payWeek: activeJob.payWeek,
            anchorPayDate: new Date(
              activeJob.anchorPayDate ?? activeJob.startDate,
            ),
            supplementalTaxRate: requireLimit(
              limitsMap,
              "supplemental_tax_rate",
            ),
            contributionAccounts: contribAccounts,
            deductions,
            taxBrackets: taxBracketInput,
            limits: limitsRecord,
            ytdGrossEarnings: 0,
            bonusPercent: toNumber(bonusTerms.bonusPercent),
            bonusMultiplier: toNumber(bonusTerms.bonusMultiplier),
            bonusOverride:
              bonusOverrides.get(`${activeJob.id}:${asOfYear}`) ?? null,
            monthsInBonusYear: bonusTerms.monthsInBonusYear ?? 12,
            includeContribInBonus: activeJob.include401kInBonus,
            bonusMonth: activeJob.bonusMonth,
            bonusDayOfMonth: activeJob.bonusDayOfMonth,
            asOfDate,
          };

          const paycheck = calculatePaycheck(paycheckInput);
          // Full-formula bonus, ignoring any current-year pin — lets the UI
          // show "target" (nominal formula) alongside "actual" (resolved/
          // pinned) instead of only ever showing the resolved value.
          const fullFormulaBonusEstimate =
            paycheckInput.bonusOverride !== null
              ? calculatePaycheck({ ...paycheckInput, bonusOverride: null })
                  .bonusEstimate
              : paycheck.bonusEstimate;

          // Blended annual computation — accounts for mid-year salary changes.
          // Skip when a salary override is active (future salary preview toggle)
          // since blended doesn't make sense with an overridden salary. A
          // Salary-Profile-pinned bonus with no salary pin is not a salary
          // override — overrideSalary is a SalaryProfileEntry object now, so
          // checking its truthiness alone would also skip blending whenever
          // only bonus terms are pinned.
          let blendedAnnual: BlendedAnnualTotals | null = null;
          if (overrideSalary?.salary === undefined) {
            const currentYear = taxYear;
            const anchorPayDate = new Date(
              activeJob.anchorPayDate ?? activeJob.startDate,
            );
            const timeline = await getSalaryTimelineForYear(
              ctx.db,
              activeJob.id,
              activeJob.annualSalary,
              currentYear,
            );
            const periodSegments = mapSalaryTimelineToPeriods(
              timeline,
              activeJob.payPeriod,
              anchorPayDate,
              currentYear,
            );

            const salarySegments: SalarySegment[] = periodSegments.map(
              (seg) => {
                let segPaycheck: typeof paycheck;
                if (seg.salary === salary) {
                  // Same salary as current — reuse the already-computed paycheck
                  segPaycheck = paycheck;
                } else {
                  // Different salary — rebuild contributions and recompute
                  const segContribs = buildContribAccounts(
                    jobContribs,
                    personalContribs,
                    seg.salary,
                    periodsPerYear,
                  );
                  segPaycheck = calculatePaycheck({
                    ...paycheckInput,
                    annualSalary: seg.salary,
                    contributionAccounts: segContribs,
                  });
                }
                return {
                  salary: seg.salary,
                  effectiveDate: seg.effectiveDate,
                  startPeriod: seg.startPeriod,
                  endPeriod: seg.endPeriod,
                  paycheck: segPaycheck,
                };
              },
            );

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
              filingStatus: activeJob.w4FilingStatus,
              taxBrackets: annualBracketInput,
              w4CheckboxOverride: null,
              asOfDate,
            };
            tax = calculateTax(taxInput);
          }

          const rawContribs = [...jobContribs, ...personalContribs];
          const budgetOverride = activeJob.budgetPeriodsPerMonth
            ? toNumber(activeJob.budgetPeriodsPerMonth)
            : null;

          return {
            person,
            job: jobForClient,
            salary,
            /** The bonus terms actually in effect (Salary Profile pin, if
             *  any, else the job record) — as numbers, for clients (e.g.
             *  the What-If tab's editor) that need to pre-fill from the
             *  resolved value rather than `job`'s raw, profile-unaware
             *  fields. Mirrors what `salary` already does for the salary
             *  axis. */
            resolvedBonusTerms: {
              bonusPercent: toNumber(bonusTerms.bonusPercent),
              bonusMultiplier: toNumber(bonusTerms.bonusMultiplier) || 1,
              monthsInBonusYear: bonusTerms.monthsInBonusYear ?? 12,
            },
            futureSalaryChanges,
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
              activeJob.payPeriod,
              budgetOverride,
            ),
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
        const filingStatus = activePeople[0]!.job!.w4FilingStatus;
        const bracketRow = allBrackets.find(
          (b) => b.filingStatus === filingStatus && b.w4Checkbox === false,
        );
        if (bracketRow) {
          const bracketInput = buildBracketInput(bracketRow, limitsMap);
          const combinedGross = activePeople.reduce((s, r) => s + r.salary, 0);
          const combinedPreTax = activePeople.reduce((s, r) => {
            const ppy = getPeriodsPerYear(r.job!.payPeriod);
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
