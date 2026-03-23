/** Paycheck router for gross-to-net pay calculations including federal/state tax withholding, pre-tax deductions, and per-period contribution breakdowns. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { calculateTax } from "@/lib/calculators/tax";
import {
  toNumber,
  getPeriodsPerYear,
  getRegularPeriodsPerMonth,
  getBudgetFrequencyNote,
  getCurrentSalary,
  getFutureSalaryChanges,
  buildContribAccounts,
  requireLimit,
  loadAndApplyContribProfile,
} from "@/server/helpers";
import type {
  PaycheckInput,
  DeductionLine,
  TaxBracketInput,
  TaxInput,
} from "@/lib/calculators/types";

/** Build TaxBracketInput from DB bracket row + limits. */
function buildBracketInput(
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
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const salaryOverrideMap = new Map(
        (input?.salaryOverrides ?? []).map((o) => [o.personId, o.salary]),
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

      // Use Promise.all since getCurrentSalary is async
      const results = await Promise.all(
        people.map(async (person) => {
          const activeJob = effectiveJobs.find(
            (j) => j.personId === person.id && !j.endDate,
          );
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

          const bracketRow = allBrackets.find(
            (b) =>
              b.filingStatus === activeJob.w4FilingStatus &&
              b.w4Checkbox === activeJob.w4Box2cChecked,
          );
          if (!bracketRow) {
            return {
              person,
              job: activeJob,
              salary: 0,
              futureSalaryChanges: [],
              paycheck: null,
              tax: null,
              rawDeductions: [],
              rawContribs: [],
            };
          }

          // Get current salary from salary_changes (falls back to job starting salary)
          const currentSalary = await getCurrentSalary(
            ctx.db,
            activeJob.id,
            activeJob.annualSalary,
            asOfDate,
          );
          const futureSalaryChanges = await getFutureSalaryChanges(
            ctx.db,
            activeJob.id,
            asOfDate,
          );
          // If a specific salary override is provided (from toggle), use it
          const overrideSalary = effectiveSalaryMap.get(person.id);
          const salary = overrideSalary ?? currentSalary;
          const periodsPerYear = getPeriodsPerYear(activeJob.payPeriod);
          const taxBracketInput = buildBracketInput(bracketRow, limitsMap);

          const jobDeductions = allDeductions.filter(
            (d) => d.jobId === activeJob.id,
          );
          const deductions: DeductionLine[] = jobDeductions.map((d) => ({
            name: d.deductionName,
            amount: toNumber(d.amountPerPeriod),
            taxTreatment: d.isPretax
              ? ("pre_tax" as const)
              : ("after_tax" as const),
            ficaExempt: d.ficaExempt,
          }));

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
            bonusPercent: toNumber(activeJob.bonusPercent),
            bonusMultiplier: toNumber(activeJob.bonusMultiplier),
            bonusOverride: activeJob.bonusOverride
              ? toNumber(activeJob.bonusOverride)
              : null,
            monthsInBonusYear: activeJob.monthsInBonusYear,
            includeContribInBonus: activeJob.includeBonusInContributions,
            bonusMonth: activeJob.bonusMonth,
            bonusDayOfMonth: activeJob.bonusDayOfMonth,
            asOfDate,
          };

          const paycheck = calculatePaycheck(paycheckInput);

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
            job: activeJob,
            salary,
            futureSalaryChanges,
            paycheck,
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
          const perPersonFicaSS = activePeople.reduce(
            (s, r) => s + (r.tax?.ficaSS ?? 0),
            0,
          );
          const perPersonFicaMed = activePeople.reduce(
            (s, r) => s + (r.tax?.ficaMedicare ?? 0),
            0,
          );
          householdTax = {
            federalTax: combinedTax.federalTax,
            ficaSS: perPersonFicaSS,
            ficaMedicare: perPersonFicaMed,
            totalTax:
              combinedTax.federalTax + perPersonFicaSS + perPersonFicaMed,
            effectiveRate:
              combinedGross > 0
                ? (combinedTax.federalTax +
                    perPersonFicaSS +
                    perPersonFicaMed) /
                  combinedGross
                : 0,
            marginalRate: combinedTax.marginalRate,
          };
        }
      }

      return { people: results, jointContribs, householdTax };
    }),
});
