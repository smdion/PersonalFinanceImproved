/** Savings router for savings goals, emergency fund calculations, planned transactions, and budget API expense integration. */
import { eq, asc, sql, lt, isNull, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
  savingsProcedure,
  type Context,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { safeDivide } from "@/lib/utils/math";
import { calculateSavings } from "@/lib/calculators/savings";
import { calculateEFund } from "@/lib/calculators/efund";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import {
  computeMaxMonthlyFunding,
  deriveBudgetMonthlyTotal,
  resolveEffectiveMonthlyContribution,
  type CapacityPerson,
} from "@/lib/calculators/savings-capacity";
import { paycheckRouter } from "./paycheck";
import { budgetRouter } from "./budget";
import {
  toNumber,
  computeBudgetAnnualTotal,
  getPeriodsPerYear,
  resolveCompensation,
  loadEffectiveSalaryProfile,
  buildContribAccounts,
  getResolvedGoalAllocations,
  upsertGoalProfileAllocation,
  resetProfileAllocationsToZero,
  getActiveBudgetProfile,
  resolveTargetBudgetProfile,
  applyContribActiveFields,
  applyJobActiveFields,
  applyDeductionActiveFields,
  fetchContributionProfile,
  buildPaycheckInputForJob,
} from "@/server/helpers";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { buildBracketInput } from "./paycheck";
import type { DeductionLine } from "@/lib/calculators/types";
import { materializeExtraPaycheckOverrides } from "@/server/helpers/extra-paycheck-materializer";
import { zDecimal } from "./settings/_shared";
import { targetModeSchema } from "@/lib/config/enum-values";
import { log } from "@/lib/logger";
import type { SavingsInput, EFundInput } from "@/lib/calculators/types";
import {
  getActiveBudgetApi,
  getClientForService,
  cacheGet,
  refreshCategoryCache,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup, BudgetTransaction } from "@/lib/budget-api";

/**
 * Compute the current net-pay-per-check for a job by running the paycheck
 * calculator against live DB data. Used to snapshot baseNetPayPerCheck when
 * routing rules or growth rates are saved, so the value always reflects the
 * actual paycheck calculation rather than a client-supplied number.
 *
 * Intentionally does not apply a salary active-value map (Plan/session pin)
 * — this value gets persisted as a recorded fact, not shown as "what your
 * finances look like under the active Plan." See applyActiveSalary's
 * docblock (server/helpers/salary.ts) for the live-vs-active rule. Salary
 * and Contribution PROFILE resolution (as opposed to a Plan/session pin) DO
 * apply here, against the globally-active profile — contribution accounts,
 * job tax-inputs (w4FilingStatus, w4Box2cChecked, additionalFedWithholding,
 * payPeriod, payWeek, anchorPayDate), and deductions all resolve the same
 * way, with no field-level carve-out (see the Contribution Profile plan's
 * governing principle). payPeriod/payWeek/anchorPayDate are the denominator
 * for every per-period value this function computes, so
 * `extraPaycheckRouting.save`/`saveGrowth` reject the save outright if the
 * globally-active profile's schedule fields don't match this job's real
 * ones, rather than persisting an internally incoherent number — see those
 * mutations.
 */
async function computeJobNetPayPerCheck(
  db: DbType,
  jobId: number,
): Promise<number> {
  const taxYear = new Date().getFullYear();
  const asOfDate = new Date();

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  if (!job)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Job not found",
    });

  const [
    allBrackets,
    rawJobDeductions,
    rawJobContribs,
    rawPersonalContribs,
    allLimits,
    activeContribSetting,
  ] = await Promise.all([
    db
      .select()
      .from(schema.taxBrackets)
      .where(eq(schema.taxBrackets.taxYear, taxYear)),
    db
      .select()
      .from(schema.paycheckDeductions)
      .where(eq(schema.paycheckDeductions.jobId, jobId)),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(
        and(
          eq(schema.contributionAccounts.jobId, jobId),
          eq(schema.contributionAccounts.isActive, true),
        ),
      ),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(
        and(
          isNull(schema.contributionAccounts.jobId),
          eq(schema.contributionAccounts.personId, job.personId),
          eq(schema.contributionAccounts.isActive, true),
        ),
      ),
    db
      .select()
      .from(schema.contributionLimits)
      .where(eq(schema.contributionLimits.taxYear, taxYear)),
    db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID)),
  ]);

  // Accounts carry no contribution value of their own — resolve against the
  // globally-ACTIVE Contribution Profile (not a Plan pin/session override),
  // matching this function's "recorded fact" philosophy for salary above.
  const activeContribProfileId = Number(activeContribSetting[0]?.value ?? NaN);
  const contribProfile = Number.isFinite(activeContribProfileId)
    ? await fetchContributionProfile(db, activeContribProfileId)
    : null;
  const contribActiveFieldsRoot = (contribProfile?.contributionActiveFields ??
    {}) as {
    contributionAccounts?: Record<string, Record<string, unknown>>;
    jobs?: Record<string, Record<string, unknown>>;
    deductions?: Record<string, Record<string, unknown>>;
  };
  const accountActiveFields =
    contribActiveFieldsRoot.contributionAccounts ?? {};
  const jobContribs = applyContribActiveFields(
    rawJobContribs,
    accountActiveFields,
  );
  const personalContribs = applyContribActiveFields(
    rawPersonalContribs,
    accountActiveFields,
  );

  // Job tax-inputs (filing status, withholding, schedule) and deductions
  // resolve against the same globally-active profile, exactly like
  // contribution accounts above — no field-level carve-out (see this
  // function's docblock). This is what makes payPeriod/w4FilingStatus/
  // deductions actually respond to a Contribution Profile switch on the
  // Paycheck page and in this persisted snapshot alike.
  const resolvedJobs = applyJobActiveFields(
    [job],
    contribActiveFieldsRoot.jobs ?? {},
  );
  const resolvedJob = resolvedJobs[0]!;
  const jobDeductions = applyDeductionActiveFields(
    rawJobDeductions,
    contribActiveFieldsRoot.deductions ?? {},
  );

  // Guard against persisting an internally-incoherent baseNetPayPerCheck:
  // payPeriod/payWeek/anchorPayDate are the denominator for every
  // per-period value this function computes, and extra-paycheck routing
  // always materializes real future transactions against the job's REAL
  // schedule (extra-paycheck-materializer.ts reads job.payPeriod/
  // anchorPayDate directly off the job row, never from this snapshot). If
  // the globally-active profile's schedule for this job doesn't match
  // reality, block the save rather than silently persist a per-check
  // amount computed under a hypothetical cadence. This function is only
  // ever called from extraPaycheckRouting.save/saveGrowth — both writes
  // that persist baseNetPayPerCheck — so the check belongs here, once.
  if (
    resolvedJob.payPeriod !== job.payPeriod ||
    resolvedJob.payWeek !== job.payWeek ||
    resolvedJob.anchorPayDate !== job.anchorPayDate
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: contribProfile
        ? `Cannot save extra-paycheck routing: profile "${contribProfile.name}" sets a pay schedule that doesn't match this job's actual pay period/anchor date. Switch the active profile to one matching this job's real schedule, or update the job's real pay period/anchor date, before saving.`
        : "Cannot save extra-paycheck routing: this job's pay schedule is inconsistent.",
    });
  }

  const limitsMap = new Map<string, number>();
  const limitsRecord: Record<string, number> = {};
  for (const l of allLimits) {
    const v = toNumber(l.value);
    limitsMap.set(l.limitType, v);
    limitsRecord[l.limitType] = v;
  }

  const bracketRow = allBrackets.find(
    (b) =>
      b.filingStatus === resolvedJob.w4FilingStatus &&
      b.w4Checkbox === resolvedJob.w4Box2cChecked,
  );
  if (!bracketRow)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: contribProfile
        ? `No tax bracket data found for the filing status set by profile "${contribProfile.name}" for this job.`
        : "No tax bracket data found for this job's filing status.",
    });

  // A job has no salary/bonus of its own — resolve against the globally-
  // ACTIVE Salary Profile (same "recorded fact" philosophy as above,
  // mirrored from the Contribution Profile resolution just above).
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const comp = resolveCompensation(salaryProfileActiveMap, job.id);
  const currentSalary = comp.salary;
  const bonusTerms = comp.terms;
  const periodsPerYear = getPeriodsPerYear(resolvedJob.payPeriod);
  const taxBrackets = buildBracketInput(bracketRow, limitsMap);

  const deductions: DeductionLine[] = jobDeductions.map((d) => ({
    name: d.deductionName,
    amount: toNumber(d.amountPerPeriod),
    taxTreatment: d.isPretax ? ("pre_tax" as const) : ("after_tax" as const),
    ficaExempt: d.ficaExempt,
  }));

  const contribAccounts = buildContribAccounts(
    jobContribs,
    personalContribs.filter((c) => c.ownership !== "joint"),
    currentSalary,
    periodsPerYear,
  );

  // Intentionally does not pass a bonusOverride — this value gets persisted
  // as a recorded fact, not a live/pinned-actual view. See this function's
  // own docblock. Uses resolvedJob (profile-patched), not the raw job, so
  // payPeriod/payWeek/anchorPayDate/w4* here match whatever this same
  // function just resolved contributions/deductions against.
  const paycheckInput = buildPaycheckInputForJob(resolvedJob, {
    salary: currentSalary,
    bonusTerms,
    bonusOverride: null,
    contributionAccounts: contribAccounts,
    deductions,
    taxBrackets,
    limitsMap,
    limitsRecord,
    asOfDate,
  });

  const paycheck = calculatePaycheck(paycheckInput);
  return Math.round(paycheck.netPay * 100) / 100;
}

/** Sum essential budget items for a given tier/column, returning monthly. */
function getEssentialExpenses(
  budgetItems: { profileId: number; isEssential: boolean; amounts: number[] }[],
  profileId: number,
  tierIndex: number,
  columnMonths: number[] | null,
): number {
  const essentials = budgetItems.filter(
    (i) => i.profileId === profileId && i.isEssential,
  );
  const annualTotal = computeBudgetAnnualTotal(
    essentials,
    tierIndex,
    columnMonths,
  );
  return annualTotal / 12;
}

/**
 * Resolve which budget tier/column the emergency fund's essential-expenses
 * total should be computed against. Shared by computeSummary (display) and
 * pushContributionsToApi (push) — they were independently re-deriving this
 * from app_settings with near-identical code, which risked the two drifting
 * apart (e.g. one honoring a future new override, or a fallback change, the
 * other not) — the E-fund target shown on screen must always match what
 * gets pushed to YNAB.
 *
 * Precedence: an explicit override (computeSummary's budgetTierOverride
 * input, e.g. "preview this tier without saving") > the e-fund's own saved
 * column setting > the shared budget-page active column > 0.
 *
 * `columnCount`, when given, clamps the result to a valid index for the
 * profile actually being read — the saved settings are global and can
 * point past the end of the current profile if it has fewer columns than
 * whichever profile was active when the settings were last saved (e.g. the
 * active profile switches from a 3-column to a 1-column layout).
 */
function resolveEfundTierIndex(
  appSettings: { key: string; value: unknown }[],
  overrideTierIndex?: number,
  columnCount?: number,
): number {
  const settingsMap = new Map(appSettings.map((s) => [s.key, s.value]));
  const budgetActiveColumn =
    typeof settingsMap.get("budget_active_column") === "number"
      ? (settingsMap.get("budget_active_column") as number)
      : 0;
  const efundSavedColumn =
    typeof settingsMap.get("efund_budget_column") === "number" &&
    (settingsMap.get("efund_budget_column") as number) >= 0
      ? (settingsMap.get("efund_budget_column") as number)
      : null;
  const resolved = overrideTierIndex ?? efundSavedColumn ?? budgetActiveColumn;
  return columnCount && columnCount > 0
    ? Math.min(resolved, columnCount - 1)
    : resolved;
}

/**
 * Live savings-capacity pool ((take-home - budgeted) across earners), via
 * the actual paycheck/budget routers — not a re-derived shortcut. Shared by
 * recalculateAllocation and lockInAllocationPercent, the only two mutations
 * allowed to move a percentage-based goal's dollar/percent (see
 * recalculateAllocation's doc comment for why display/push never do this
 * live automatically).
 *
 * `profileId` lets a caller target a specific budget profile instead of
 * whichever one is currently active; omitting it preserves the
 * active-profile default. This is deliberately a *separate* computation
 * from computeSummary's totalMonthlyPool (which sums each goal's stored
 * monthlyContribution snapshot, not a live paycheck/budget derivation) —
 * they aren't two paths to the same number today. The budget-monthly-total
 * derivation itself goes through deriveBudgetMonthlyTotal — the single
 * computation path for that step, shared with savings/page.tsx's own two
 * capacity computations.
 */
async function computeLiveMaxMonthlyFunding(
  ctx: Context,
  profileId?: number,
): Promise<number | null> {
  const paycheckCaller = createCallerFactory(paycheckRouter)(ctx);
  const budgetCaller = createCallerFactory(budgetRouter)(ctx);
  const [paycheckData, budgetSummary] = await Promise.all([
    paycheckCaller.computeSummary(),
    budgetCaller.computeActiveSummary(profileId ? { profileId } : undefined),
  ]);
  const budgetMonthlyTotal = deriveBudgetMonthlyTotal(budgetSummary);
  return paycheckData && budgetMonthlyTotal !== null
    ? computeMaxMonthlyFunding(
        paycheckData.people as CapacityPerson[],
        budgetMonthlyTotal,
      )
    : null;
}

/** Accepts both the main db instance and transaction handles. */
type DbType =
  Context["db"] | Parameters<Parameters<Context["db"]["transaction"]>[0]>[0];

/** A transfer's two legs must settle/unsettle together — otherwise money
 *  silently vanishes from (or reappears in) the combined projection. */
async function resolvePairedPlannedTxIds(
  db: DbType,
  plannedTxId: number,
): Promise<number[]> {
  const [row] = await db
    .select({
      transferPairId: schema.savingsPlannedTransactions.transferPairId,
    })
    .from(schema.savingsPlannedTransactions)
    .where(eq(schema.savingsPlannedTransactions.id, plannedTxId));
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Planned transaction not found",
    });
  }
  if (!row.transferPairId) return [plannedTxId];
  const pairRows = await db
    .select({ id: schema.savingsPlannedTransactions.id })
    .from(schema.savingsPlannedTransactions)
    .where(
      eq(schema.savingsPlannedTransactions.transferPairId, row.transferPairId),
    );
  return pairRows.map((r) => r.id);
}

async function settleOccurrence(
  db: DbType,
  input: { plannedTxId: number; occurrenceMonth: string },
) {
  const pairIds = await resolvePairedPlannedTxIds(db, input.plannedTxId);
  const monthDate = `${input.occurrenceMonth}-01`;
  const existing = await db
    .select({ id: schema.savingsPlannedTxSettlements.id })
    .from(schema.savingsPlannedTxSettlements)
    .where(
      and(
        eq(schema.savingsPlannedTxSettlements.plannedTxId, input.plannedTxId),
        eq(schema.savingsPlannedTxSettlements.occurrenceMonth, monthDate),
      ),
    );
  if (existing.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Already settled." });
  }
  await db.insert(schema.savingsPlannedTxSettlements).values(
    pairIds.map((id) => ({
      plannedTxId: id,
      occurrenceMonth: monthDate,
    })),
  );
  return { ok: true };
}

const plannedTransactionInput = z.object({
  goalId: z.number().int(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: zDecimal, // positive = deposit, negative = withdrawal
  description: z.string().min(1),
  isRecurring: z.boolean().default(false),
  recurrenceMonths: z.number().int().min(1).nullable().optional(),
});

const savingsGoalInput = z.object({
  name: z.string().min(1),
  parentGoalId: z.number().int().nullable().optional(),
  targetAmount: zDecimal.nullable().optional(),
  targetMonths: z.number().int().nullable().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isEmergencyFund: z.boolean().default(false),
  targetMode: targetModeSchema.default("fixed"),
});

export const savingsRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(z.object({ budgetTierOverride: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const [
        goals,
        selfLoans,
        activeProfile,
        budgetItems,
        plannedTransactions,
        allocationOverrides,
        appSettings,
        settlements,
      ] = await Promise.all([
        ctx.db
          .select()
          .from(schema.savingsGoals)
          .orderBy(asc(schema.savingsGoals.priority)),
        ctx.db
          .select()
          .from(schema.selfLoans)
          .where(lt(schema.selfLoans.repaidAmount, schema.selfLoans.amount)),
        getActiveBudgetProfile(ctx.db),
        ctx.db.select().from(schema.budgetItems),
        ctx.db
          .select()
          .from(schema.savingsPlannedTransactions)
          .orderBy(asc(schema.savingsPlannedTransactions.transactionDate)),
        ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .orderBy(asc(schema.savingsAllocationOverrides.monthDate)),
        ctx.db.select().from(schema.appSettings),
        ctx.db.select().from(schema.savingsPlannedTxSettlements),
      ]);

      // Get latest balance for each active goal from savings_monthly (single query)
      const activeGoals = goals.filter((g) => g.isActive);
      const activeGoalIds = activeGoals.map((g) => g.id);

      const balanceMap = new Map<number, number>();
      if (activeGoalIds.length > 0) {
        const { isPostgres } = await import("@/lib/db/dialect");
        const { queryRaw } = await import("@/lib/db/compat");
        const inList = sql.join(
          activeGoalIds.map((id) => sql`${id}`),
          sql`, `,
        );
        const latestBalances = isPostgres()
          ? await queryRaw<{ goal_id: number; balance: string }>(
              ctx.db,
              sql`
              SELECT DISTINCT ON (goal_id) goal_id, balance
              FROM savings_monthly
              WHERE goal_id IN (${inList})
              ORDER BY goal_id, month_date DESC
            `,
            )
          : await queryRaw<{ goal_id: number; balance: string }>(
              ctx.db,
              sql`
              SELECT goal_id, balance FROM savings_monthly t1
              WHERE month_date = (
                SELECT MAX(t2.month_date) FROM savings_monthly t2
                WHERE t2.goal_id = t1.goal_id
              )
              AND goal_id IN (${inList})
            `,
            );
        for (const row of latestBalances) {
          balanceMap.set(row.goal_id, toNumber(row.balance));
        }
      }

      // Override balances for API-linked goals with live YNAB cache values
      const apiLinkedGoals = activeGoals.filter(
        (g) => g.isApiSyncEnabled && g.apiCategoryId,
      );
      if (apiLinkedGoals.length > 0) {
        const active = await getActiveBudgetApi(ctx.db);
        if (active !== "none") {
          const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
            ctx.db,
            active,
            "categories",
          );
          if (categoriesCache) {
            const catBalanceMap = new Map<string, number>();
            for (const group of categoriesCache.data) {
              for (const cat of group.categories) {
                catBalanceMap.set(cat.id, cat.balance);
              }
            }
            for (const goal of apiLinkedGoals) {
              const apiBalance = catBalanceMap.get(goal.apiCategoryId!);
              if (apiBalance !== undefined) {
                balanceMap.set(goal.id, apiBalance);
              }
            }
          }
        }
      }

      // Budget profile info for tier selection
      const budgetTierLabels = activeProfile?.columnLabels ?? [];

      const efundGoal = activeGoals.find((g) => g.isEmergencyFund);
      const efundTierIndex = resolveEfundTierIndex(
        appSettings,
        input?.budgetTierOverride,
        budgetTierLabels.length,
      );

      // Essential expenses for e-fund tier
      let essentialMonthlyExpenses = 0;
      if (activeProfile) {
        essentialMonthlyExpenses = getEssentialExpenses(
          budgetItems as {
            profileId: number;
            isEssential: boolean;
            amounts: number[];
          }[],
          activeProfile.id,
          efundTierIndex,
          activeProfile.columnMonths ?? null,
        );
      }

      // E-Fund calculator (compute before savings so e-fund target flows into projections)
      let efundResult = null;

      if (efundGoal) {
        // Self-loan tracking is exclusive: if a YNAB reimbursement category is
        // linked, its goalTarget is the source of truth (YNAB-tracked workflow).
        // Otherwise fall back to the Ledgr DB self_loans table. Using both at
        // once causes double-counting because the same money appears in both places.
        let outstandingSelfLoans: number;
        if (efundGoal.reimbursementApiCategoryId) {
          const active = await getActiveBudgetApi(ctx.db);
          outstandingSelfLoans = 0;
          if (active !== "none") {
            const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
              ctx.db,
              active,
              "categories",
            );
            if (categoriesCache) {
              for (const group of categoriesCache.data) {
                for (const cat of group.categories) {
                  if (cat.id === efundGoal.reimbursementApiCategoryId) {
                    outstandingSelfLoans = cat.goalTarget ?? 0;
                  }
                }
              }
            }
          }
        } else {
          outstandingSelfLoans = selfLoans
            .filter((l) => l.fromGoalId === efundGoal.id)
            .reduce(
              (s, l) => s + (toNumber(l.amount) - toNumber(l.repaidAmount)),
              0,
            );
        }

        const efundInput: EFundInput = {
          emergencyFundBalance: balanceMap.get(efundGoal.id) ?? 0,
          outstandingSelfLoans,
          essentialMonthlyExpenses,
          targetMonths: efundGoal.targetMonths ?? 4,
          asOfDate: new Date(),
        };
        efundResult = calculateEFund(efundInput);
      }

      // Resolve each goal's funding for the active profile — funding is
      // entirely per-profile, no shared default (see getResolvedGoalAllocations,
      // the only path that reads allocationPercent/monthlyContribution).
      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        goals,
        activeProfile?.id ?? null,
      );

      // Calculate total monthly contributions for the pool
      const totalMonthlyPool = activeGoals.reduce(
        (s, g) => s + (resolvedByGoal.get(g.id)?.monthlyContribution ?? 0),
        0,
      );

      const savingsInput: SavingsInput = {
        goals: activeGoals.map((g) => {
          const monthlyContrib =
            resolvedByGoal.get(g.id)?.monthlyContribution ?? 0;
          // E-fund target is derived from calculator (targetMonths × essential expenses)
          const targetBalance =
            g.isEmergencyFund && efundResult
              ? efundResult.targetAmount
              : toNumber(g.targetAmount);
          // E-fund uses balanceWithRepay so the savings goal list stays consistent
          // with the e-fund detail card (both show the "after repay" view).
          const currentBalance =
            g.isEmergencyFund && efundResult
              ? efundResult.balanceWithRepay
              : (balanceMap.get(g.id) ?? 0);
          return {
            id: g.id,
            name: g.name,
            currentBalance,
            targetBalance,
            allocationPercent: safeDivide(monthlyContrib, totalMonthlyPool, 0),
            isEmergencyFund: g.isEmergencyFund,
            isActive: g.isActive,
          };
        }),
        monthlySavingsPool: totalMonthlyPool,
        essentialMonthlyExpenses,
        asOfDate: new Date(),
      };

      const savingsResult = calculateSavings(savingsInput);

      // Group settlements by plannedTxId → occurrence-month strings ("YYYY-MM"),
      // normalized from the stored date (always the 1st of the month).
      const settledByTxId = new Map<number, string[]>();
      for (const s of settlements) {
        const list = settledByTxId.get(s.plannedTxId) ?? [];
        list.push(s.occurrenceMonth.slice(0, 7));
        settledByTxId.set(s.plannedTxId, list);
      }

      // Transform planned transactions for the client
      const plannedTx = plannedTransactions.map((t) => ({
        id: t.id,
        goalId: t.goalId,
        transactionDate: t.transactionDate,
        amount: toNumber(t.amount),
        description: t.description,
        isRecurring: t.isRecurring,
        recurrenceMonths: t.recurrenceMonths,
        transferPairId: t.transferPairId,
        source: t.source ?? "manual",
        settledOccurrences: settledByTxId.get(t.id) ?? [],
      }));

      // Transform allocation overrides for the client
      const overrides = allocationOverrides.map((o) => ({
        id: o.id,
        goalId: o.goalId,
        monthDate: o.monthDate,
        amount: toNumber(o.amount),
        source: o.source ?? "manual",
      }));

      // goals sent to the client carry the RESOLVED funding for the active
      // profile as synthesized fields (savings_goals itself has no funding
      // columns anymore) — every client-side consumer (fund cards,
      // recalculate/lock-in previews) reads allocationPercent/
      // monthlyContribution straight off this list, so resolving once here
      // keeps them all correct without each one re-deriving it.
      const goalsForClient = goals.map((g) => {
        // getResolvedGoalAllocations always returns one entry per input
        // goal (defaulting to $0/no-percent), never leaves one unset.
        const resolved = resolvedByGoal.get(g.id)!;
        return {
          ...g,
          allocationPercent:
            resolved.allocationPercent != null
              ? resolved.allocationPercent.toFixed(3)
              : null,
          monthlyContribution: resolved.monthlyContribution.toFixed(2),
        };
      });

      return {
        savings: savingsResult,
        efund: efundResult,
        goals: goalsForClient,
        budgetTierLabels,
        efundTierIndex,
        plannedTransactions: plannedTx,
        allocationOverrides: overrides,
      };
    }),

  // ══ PLANNED TRANSACTIONS ══
  plannedTransactions: createTRPCRouter({
    create: savingsProcedure
      .input(plannedTransactionInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.savingsPlannedTransactions)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: savingsProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(plannedTransactionInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [row] = await ctx.db
          .select({ source: schema.savingsPlannedTransactions.source })
          .from(schema.savingsPlannedTransactions)
          .where(eq(schema.savingsPlannedTransactions.id, id));
        if (row?.source === "rule") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Auto-generated transactions cannot be edited. Manage them via the Extra Paychecks tab.",
          });
        }
        return ctx.db
          .update(schema.savingsPlannedTransactions)
          .set(data)
          .where(
            and(
              eq(schema.savingsPlannedTransactions.id, id),
              eq(schema.savingsPlannedTransactions.source, "manual"),
            ),
          )
          .returning()
          .then((r) => r[0]);
      }),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ source: schema.savingsPlannedTransactions.source })
          .from(schema.savingsPlannedTransactions)
          .where(eq(schema.savingsPlannedTransactions.id, input.id));
        if (row?.source === "rule") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Auto-generated transactions cannot be deleted. Manage them via the Extra Paychecks tab.",
          });
        }
        return ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(
            and(
              eq(schema.savingsPlannedTransactions.id, input.id),
              eq(schema.savingsPlannedTransactions.source, "manual"),
            ),
          );
      }),
    // Settlement is per-occurrence (plannedTxId + occurrenceMonth), never
    // per-row — a recurring row has many future occurrences, and settling
    // one must not hide the others from the projection. Never invoked
    // automatically (e.g. from sync); always an explicit user action.
    settle: savingsProcedure
      .input(
        z.object({
          plannedTxId: z.number().int(),
          occurrenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
        }),
      )
      .mutation(({ ctx, input }) => settleOccurrence(ctx.db, input)),
    unsettle: savingsProcedure
      .input(
        z.object({
          plannedTxId: z.number().int(),
          occurrenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const pairIds = await resolvePairedPlannedTxIds(
          ctx.db,
          input.plannedTxId,
        );
        const monthDate = `${input.occurrenceMonth}-01`;
        await ctx.db
          .delete(schema.savingsPlannedTxSettlements)
          .where(
            and(
              inArray(schema.savingsPlannedTxSettlements.plannedTxId, pairIds),
              eq(schema.savingsPlannedTxSettlements.occurrenceMonth, monthDate),
            ),
          );
        return { ok: true };
      }),
    settleMany: savingsProcedure
      .input(
        z.object({
          occurrences: z.array(
            z.object({
              plannedTxId: z.number().int(),
              occurrenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          for (const occ of input.occurrences) {
            await settleOccurrence(tx, occ);
          }
          return { ok: true };
        });
      }),
    // Presence-based hint only — never a write. A trip is many small real
    // charges that never cleanly sum to one planned placeholder amount, so
    // this deliberately doesn't try to match dollar amounts: once ANY real
    // transaction posts in the goal's linked category on/after the planned
    // date, in the same month, the live balance already reflects it and the
    // placeholder's forecasting job is done. Surfaced as a dismissible
    // suggestion the user confirms — settlement itself only ever happens via
    // the settle/settleMany mutations above.
    getSettlementSuggestions: protectedProcedure.query(async ({ ctx }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") return { suggestions: [] };

      const transactionsCache = await cacheGet<BudgetTransaction[]>(
        ctx.db,
        active,
        "transactions",
      );
      if (!transactionsCache) return { suggestions: [] };
      const realTransactions = transactionsCache.data;

      const [rows, settlements, goals] = await Promise.all([
        ctx.db
          .select({
            id: schema.savingsPlannedTransactions.id,
            goalId: schema.savingsPlannedTransactions.goalId,
            transactionDate: schema.savingsPlannedTransactions.transactionDate,
          })
          .from(schema.savingsPlannedTransactions),
        ctx.db
          .select({
            plannedTxId: schema.savingsPlannedTxSettlements.plannedTxId,
            occurrenceMonth: schema.savingsPlannedTxSettlements.occurrenceMonth,
          })
          .from(schema.savingsPlannedTxSettlements),
        ctx.db
          .select({
            id: schema.savingsGoals.id,
            apiCategoryId: schema.savingsGoals.apiCategoryId,
          })
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isApiSyncEnabled, true)),
      ]);

      const settledSet = new Set(
        settlements.map(
          (s) => `${s.plannedTxId}:${s.occurrenceMonth.slice(0, 7)}`,
        ),
      );
      const apiCategoryByGoal = new Map(
        goals
          .filter((g) => g.apiCategoryId)
          .map((g) => [g.id, g.apiCategoryId!]),
      );

      // Real transactions grouped by category + month ("YYYY-MM"), keeping
      // only the earliest date per group (the check is "is there activity
      // on/after the planned date", so the earliest is the strictest test).
      const realByCategoryMonth = new Map<string, string>();
      for (const t of realTransactions) {
        if (t.deleted || !t.categoryId) continue;
        const month = t.date.slice(0, 7);
        const key = `${t.categoryId}:${month}`;
        const existing = realByCategoryMonth.get(key);
        if (!existing || t.date < existing) {
          realByCategoryMonth.set(key, t.date);
        }
      }

      const suggestions: { plannedTxId: number; occurrenceMonth: string }[] =
        [];
      for (const row of rows) {
        const categoryId = apiCategoryByGoal.get(row.goalId);
        if (!categoryId) continue;
        // v1 scope: only the row's own occurrence, not every future
        // occurrence of a recurring row — a future occurrence can't have a
        // matching real transaction yet anyway.
        const occurrenceMonth = row.transactionDate.slice(0, 7);
        if (settledSet.has(`${row.id}:${occurrenceMonth}`)) continue;
        const earliestReal = realByCategoryMonth.get(
          `${categoryId}:${occurrenceMonth}`,
        );
        if (earliestReal && earliestReal >= row.transactionDate) {
          suggestions.push({ plannedTxId: row.id, occurrenceMonth });
        }
      }
      return { suggestions };
    }),
  }),

  // ══ ALLOCATION OVERRIDES ══
  allocationOverrides: createTRPCRouter({
    upsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Upsert: insert or update on conflict
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId))
          .then((rows) => rows.find((r) => r.monthDate === input.monthDate));

        if (existing) {
          return ctx.db
            .update(schema.savingsAllocationOverrides)
            .set({ amount: String(input.amount) })
            .where(eq(schema.savingsAllocationOverrides.id, existing.id))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.savingsAllocationOverrides)
          .values({
            goalId: input.goalId,
            monthDate: input.monthDate,
            amount: String(input.amount),
          })
          .returning()
          .then((r) => r[0]);
      }),
    delete: savingsProcedure
      .input(z.object({ goalId: z.number().int(), monthDate: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId));
        const target = rows.find((r) => r.monthDate === input.monthDate);
        if (target) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, target.id));
        }
        return { ok: true };
      }),
    /** Delete all overrides for ALL goals in one or more months. */
    deleteMonth: savingsProcedure
      .input(
        z.object({
          monthDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.monthDates.length === 0) return { ok: true };
        const monthSet = new Set(input.monthDates);
        const allOverrides = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides);
        const toDelete = allOverrides.filter((r) => monthSet.has(r.monthDate));
        for (const row of toDelete) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, row.id));
        }
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals in a single month (pool-constrained). */
    upsertMonth: savingsProcedure
      .input(
        z.object({
          monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Delete all existing overrides for this month across all goals
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .then((rows) => rows.filter((r) => r.monthDate === input.monthDate));

        for (const row of existing) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, row.id));
        }

        // Insert new overrides (skip if amount matches default — caller handles that)
        for (const alloc of input.allocations) {
          await ctx.db.insert(schema.savingsAllocationOverrides).values({
            goalId: alloc.goalId,
            monthDate: input.monthDate,
            amount: String(alloc.amount),
          });
        }
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals across a month range (fill-forward). */
    upsertMonthRange: savingsProcedure
      .input(
        z.object({
          startMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          endMonth: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          monthDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const targetMonths = input.monthDates.filter(
          (md) =>
            md >= input.startMonth &&
            (input.endMonth === null || md <= input.endMonth),
        );

        for (const monthDate of targetMonths) {
          // Delete existing overrides for this month
          const existing = await ctx.db
            .select()
            .from(schema.savingsAllocationOverrides)
            .then((rows) => rows.filter((r) => r.monthDate === monthDate));

          for (const row of existing) {
            await ctx.db
              .delete(schema.savingsAllocationOverrides)
              .where(eq(schema.savingsAllocationOverrides.id, row.id));
          }

          // Insert new overrides
          for (const alloc of input.allocations) {
            await ctx.db.insert(schema.savingsAllocationOverrides).values({
              goalId: alloc.goalId,
              monthDate,
              amount: String(alloc.amount),
            });
          }
        }
        return { ok: true };
      }),

    /** Batch upsert overrides for a single goal (fill-down, change-all-after). */
    batchUpsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          overrides: z.array(
            z.object({
              monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              amount: z.number(),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId));
        const existingByDate = new Map(existing.map((r) => [r.monthDate, r]));

        for (const o of input.overrides) {
          const row = existingByDate.get(o.monthDate);
          if (row) {
            await ctx.db
              .update(schema.savingsAllocationOverrides)
              .set({ amount: String(o.amount) })
              .where(eq(schema.savingsAllocationOverrides.id, row.id));
          } else {
            await ctx.db.insert(schema.savingsAllocationOverrides).values({
              goalId: input.goalId,
              monthDate: o.monthDate,
              amount: String(o.amount),
            });
          }
        }
        return { ok: true };
      }),
  }),

  // ══ PER-PROFILE SAVINGS FUNDING ══
  // How much a goal is funded, and how (percent vs. flat dollar), is owned
  // entirely per budget profile — no shared default a profile falls back
  // to (e.g. "Car fund gets 12% under my current budget, $0 under a
  // relocation what-if" — both are just that profile's own row). Edited
  // from the budget page, scoped to whichever profile is being viewed
  // there — see getResolvedGoalAllocations for the single resolution path
  // this and every other reader/writer goes through.
  goalProfileAllocations: createTRPCRouter({
    /** Every active goal's funding for a given profile. */
    list: protectedProcedure
      .input(z.object({ profileId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const goals = await ctx.db
          .select()
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true))
          .orderBy(asc(schema.savingsGoals.priority));
        const resolved = await getResolvedGoalAllocations(
          ctx.db,
          goals,
          input.profileId,
        );
        return goals.map((g) => {
          const r = resolved.get(g.id)!;
          return {
            goalId: g.id,
            name: g.name,
            isEmergencyFund: g.isEmergencyFund,
            allocationPercent: r.allocationPercent,
            monthlyContribution: r.monthlyContribution,
          };
        });
      }),
    /** Per-profile summary (total funded monthly + how many goals have a
     *  nonzero allocation) for every budget profile at once — for the
     *  profile-picker sidebar. Routes through the same resolver as `list`
     *  above (one call per profile) rather than re-deriving totals
     *  independently. */
    listSummaries: protectedProcedure.query(async ({ ctx }) => {
      const [goals, profiles] = await Promise.all([
        ctx.db
          .select()
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true)),
        ctx.db
          .select({ id: schema.budgetProfiles.id })
          .from(schema.budgetProfiles),
      ]);
      return Promise.all(
        profiles.map(async (p) => {
          const resolved = await getResolvedGoalAllocations(
            ctx.db,
            goals,
            p.id,
          );
          let totalMonthlyAllocation = 0;
          let fundedGoalCount = 0;
          for (const r of resolved.values()) {
            totalMonthlyAllocation += r.monthlyContribution;
            if (r.monthlyContribution > 0 || (r.allocationPercent ?? 0) > 0)
              fundedGoalCount++;
          }
          return { profileId: p.id, totalMonthlyAllocation, fundedGoalCount };
        }),
      );
    }),
    /** Manual edit — sets (goalId, profileId)'s funding directly, independent
     *  of the live pool (contrast with recalculateAllocation/
     *  lockInAllocationPercent, which also write here but derive the value
     *  from the live pool instead of taking it directly from the caller). */
    upsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          profileId: z.number().int(),
          allocationPercent: z.number().nullable(),
          monthlyContribution: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await upsertGoalProfileAllocation(
          ctx.db,
          input.goalId,
          input.profileId,
          {
            allocationPercent: input.allocationPercent,
            monthlyContribution: input.monthlyContribution,
          },
        );
        return { ok: true };
      }),
    /** Set every active goal's funding to $0/no-percent for one profile. */
    resetAllToZero: savingsProcedure
      .input(z.object({ profileId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const goals = await ctx.db
          .select({ id: schema.savingsGoals.id })
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true));
        await resetProfileAllocationsToZero(
          ctx.db,
          goals.map((g) => g.id),
          input.profileId,
        );
        return { ok: true };
      }),
  }),

  // ══ API CATEGORY SYNC ══

  /** Link a savings goal to a budget API category. */
  linkGoalToApi: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({
          apiCategoryId: input.apiCategoryId,
          apiCategoryName: input.apiCategoryName,
          isApiSyncEnabled: true,
        })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  /** Unlink a savings goal from a budget API category. */
  unlinkGoalFromApi: savingsProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({
          apiCategoryId: null,
          apiCategoryName: null,
          isApiSyncEnabled: false,
        })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  // ══ CONVERSION: BUDGET ITEM ↔ SAVINGS GOAL ══

  /** Convert a budget item into a savings goal, transferring the API category link. */
  convertBudgetItemToGoal: savingsProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        goalName: z.string().min(1),
        monthlyContribution: z.string().default("0"),
        targetAmount: z.string().nullable().optional(),
        targetMode: targetModeSchema.default("ongoing"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the budget item
      const [item] = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget item not found",
        });

      // Create the savings goal with the API link transferred
      const [goal] = await ctx.db
        .insert(schema.savingsGoals)
        .values({
          name: input.goalName,
          targetAmount: input.targetAmount ?? null,
          targetMode: input.targetMode,
          apiCategoryId: item.apiCategoryId,
          apiCategoryName: item.apiCategoryName,
          isApiSyncEnabled: !!item.apiCategoryId,
        })
        .returning();

      // Funding is per-profile with no shared default — seed every existing
      // budget profile with the converted amount (closest match to the old
      // shared-default behavior; the user can customize per-profile after).
      const profiles = await ctx.db
        .select({ id: schema.budgetProfiles.id })
        .from(schema.budgetProfiles);
      if (goal && profiles.length > 0) {
        await ctx.db.insert(schema.savingsGoalProfileAllocations).values(
          profiles.map((p) => ({
            goalId: goal.id,
            budgetProfileId: p.id,
            allocationPercent: null,
            monthlyContribution: input.monthlyContribution,
          })),
        );
      }

      // Delete the budget item
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));

      return goal;
    }),

  /** Convert a savings goal into a budget item, transferring the API category link. */
  convertGoalToBudgetItem: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        category: z.string().min(1),
        subcategory: z.string().min(1),
        isEssential: z.boolean().default(false),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the savings goal
      const [goal] = await ctx.db
        .select()
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Savings goal not found",
        });

      // Target profile: explicit input.profileId (a client editing a
      // Plan-pinned/viewed non-active profile) else the globally-active one.
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile",
        });

      const numCols = profile.columnLabels.length;
      const amounts = new Array(numCols).fill(0) as number[];

      // Place at end of category
      const existingItems = await ctx.db
        .select({
          sortOrder: schema.budgetItems.sortOrder,
          category: schema.budgetItems.category,
        })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const sameCat = existingItems.filter(
        (i) => i.category === input.category,
      );
      const maxSort =
        sameCat.length > 0
          ? Math.max(...sameCat.map((i) => i.sortOrder))
          : existingItems.length > 0
            ? Math.max(...existingItems.map((i) => i.sortOrder))
            : 0;

      // Create budget item with the API link transferred
      const [item] = await ctx.db
        .insert(schema.budgetItems)
        .values({
          profileId: profile.id,
          category: input.category,
          subcategory: input.subcategory,
          amounts,
          isEssential: input.isEssential,
          sortOrder: maxSort + 1,
          apiCategoryId: goal.apiCategoryId,
          apiCategoryName: goal.apiCategoryName,
          apiSyncDirection: "pull",
        })
        .returning();

      // Delete the savings goal (cascades to savings_monthly, planned transactions, overrides)
      await ctx.db
        .delete(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));

      return item;
    }),

  /** Get API category balances for linked savings goals (for display). */
  listApiBalances: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { balances: [], service: null };

    const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
      ctx.db,
      active,
      "categories",
    );
    if (!categoriesCache) return { balances: [], service: active };

    const catMap = new Map<
      string,
      {
        balance: number;
        budgeted: number;
        activity: number;
        goalTarget?: number;
      }
    >();
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        catMap.set(cat.id, {
          balance: cat.balance,
          budgeted: cat.budgeted,
          activity: cat.activity,
          goalTarget: cat.goalTarget,
        });
      }
    }

    const goals = await ctx.db.select().from(schema.savingsGoals);
    const balances = goals
      .filter((g) => g.isApiSyncEnabled && g.apiCategoryId)
      .map((g) => {
        const cat = catMap.get(g.apiCategoryId!);
        return {
          goalId: g.id,
          apiCategoryName: g.apiCategoryName,
          balance: cat?.balance ?? 0,
          budgeted: cat?.budgeted ?? 0,
          activity: cat?.activity ?? 0,
          goalTarget: cat?.goalTarget ?? null,
        };
      });

    return { balances, service: active };
  }),

  /**
   * Push goal target amounts to the budget API for linked sinking funds.
   * - Sinking funds: pushes monthlyContribution via updateCategoryGoalTarget
   *   (recurring monthly-assignment amount).
   * - Emergency fund: pushes computed targetAmount (targetMonths × essentials)
   *   via updateCategoryTargetBalance — amount only, never touches the
   *   goal's type/cadence (that has to be configured once, manually, in
   *   YNAB; see updateCategoryTargetBalance's implementation for why).
   * Can optionally push a single goal by ID.
   */
  pushContributionsToApi: savingsProcedure
    .input(z.object({ goalId: z.number().int().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      // Resolve the active service once (not via getBudgetAPIClient, which
      // wraps this same lookup but doesn't hand back which service it
      // resolved) — mirrors budget.syncBudgetToApi, and avoids querying
      // active_budget_api twice in one request (once here, again at the
      // end to know which cache to refresh).
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }
      const client = await getClientForService(ctx.db, active);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }

      const [goals, activeProfile, budgetItems, appSettings] =
        await Promise.all([
          ctx.db.select().from(schema.savingsGoals),
          getActiveBudgetProfile(ctx.db),
          ctx.db.select().from(schema.budgetItems),
          ctx.db.select().from(schema.appSettings),
        ]);

      const linked = goals.filter((g) => g.isApiSyncEnabled && g.apiCategoryId);
      const toPush = input?.goalId
        ? linked.filter((g) => g.id === input.goalId)
        : linked;

      if (toPush.length === 0) return { pushed: 0 };

      // Same tier resolution as computeSummary — see resolveEfundTierIndex.
      const efundTierIndex = resolveEfundTierIndex(
        appSettings,
        undefined,
        activeProfile?.columnLabels?.length,
      );
      const essentialExpenses = activeProfile
        ? getEssentialExpenses(
            budgetItems as {
              profileId: number;
              isEssential: boolean;
              amounts: number[];
            }[],
            activeProfile.id,
            efundTierIndex,
            activeProfile.columnMonths ?? null,
          )
        : 0;

      // Resolve through the same path computeSummary uses — pushing the
      // raw savings_goals column would push the goal's global default
      // instead of whatever's actually in effect for the active profile.
      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        toPush,
        activeProfile?.id ?? null,
      );

      let pushed = 0;
      for (const goal of toPush) {
        try {
          if (goal.isEmergencyFund) {
            // E-fund: push the computed total target amount only. The
            // goal's type/cadence (target-balance vs. recurring) has to be
            // configured once, manually, in YNAB — updateCategoryTargetBalance
            // intentionally only updates goal_target and never touches the
            // goal's shape (see its implementation for why).
            const targetMonths = goal.targetMonths ?? 4;
            const targetAmount = targetMonths * essentialExpenses;
            if (targetAmount > 0) {
              await client.updateCategoryTargetBalance(
                goal.apiCategoryId!,
                targetAmount,
              );
              pushed++;
            }
          } else {
            // Push the resolved snapshot, not a live percentage-of-income
            // recompute — a percentage-based goal's dollar amount should
            // only move when the user explicitly hits "Recalculate"
            // (recalculateAllocation), not silently whenever paycheck/
            // budget data changes underneath it. See recalculateAllocation
            // for the live derivation and resolveEffectiveMonthlyContribution
            // for the shared formula it uses.
            const monthly =
              resolvedByGoal.get(goal.id)?.monthlyContribution ?? 0;
            if (monthly > 0) {
              await client.updateCategoryGoalTarget(
                goal.apiCategoryId!,
                monthly,
              );
              pushed++;
            }
          }
        } catch (err) {
          log("warn", "push_goal_target_failed", {
            goalId: goal.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Refresh the cache so subsequent previews reflect what was just
      // pushed instead of stale pre-push data (see budget.syncBudgetToApi
      // for the same fix and full rationale).
      if (pushed > 0) {
        await refreshCategoryCache(ctx.db, active, client);
      }

      return { pushed };
    }),

  /**
   * Recompute a percentage-based savings goal's monthly_contribution from
   * the CURRENT live pool ((allocationPercent/100) * maxMonthlyFunding) and
   * persist it as a savings_goal_profile_allocations override for the
   * target profile (profileId, or the active profile if omitted) — never
   * the raw savings_goals columns; see getResolvedGoalAllocations for why
   * those columns aren't read/written anywhere except goal creation. This
   * is the only path that lets a percentage-based goal's dollar amount
   * move — display and push both read the resolved override directly (see
   * pushContributionsToApi), so a salary/budget change never silently
   * changes what's shown or sent to the budget API until the user
   * explicitly asks for it here.
   * Omitting goalId recalculates every active percentage-based goal (for
   * the target profile) from one shared live-pool snapshot (a single fetch
   * applied to all rows, so a batch recalc can't see the pool shift
   * mid-batch the way N separate live reads could).
   */
  recalculateAllocation: savingsProcedure
    .input(
      z
        .object({
          goalId: z.number().int().optional(),
          profileId: z.number().int().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const [goals, targetProfile] = await Promise.all([
        ctx.db.select().from(schema.savingsGoals),
        resolveTargetBudgetProfile(ctx.db, input?.profileId),
      ]);
      const targetProfileId = targetProfile?.id;
      if (targetProfileId === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile to recalculate against",
        });
      }

      // Resolve against the target profile's own overrides — a goal that's
      // only percentage-based under this profile (not globally) must still
      // be picked up, and one that's been overridden to flat-dollar under
      // this profile must be excluded even if its global default is a %.
      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        goals,
        targetProfileId,
      );
      const targets = goals.filter(
        (g) =>
          g.isActive &&
          resolvedByGoal.get(g.id)?.allocationPercent != null &&
          (input?.goalId === undefined || g.id === input.goalId),
      );
      if (targets.length === 0) return { updated: 0 };

      const maxMonthlyFunding = await computeLiveMaxMonthlyFunding(
        ctx,
        targetProfileId,
      );
      if (maxMonthlyFunding === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No live paycheck/budget data available to recalculate from",
        });
      }
      if (maxMonthlyFunding <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current income pool is zero or negative — can't recalculate allocations",
        });
      }

      await ctx.db.transaction(async (tx) => {
        for (const g of targets) {
          const resolved = resolvedByGoal.get(g.id)!;
          const newAmount = resolveEffectiveMonthlyContribution(
            resolved.allocationPercent,
            maxMonthlyFunding,
            resolved.monthlyContribution,
          );
          await upsertGoalProfileAllocation(tx, g.id, targetProfileId, {
            allocationPercent: resolved.allocationPercent,
            monthlyContribution: newAmount,
          });
        }
      });

      return { updated: targets.length };
    }),

  /**
   * Inverse of recalculateAllocation: holds monthly_contribution (the
   * dollar amount) fixed and recomputes allocation_percent to match what
   * share of the CURRENT live pool that dollar amount represents. Use this
   * after a raise when you want to keep sending the same dollar amount to
   * a goal (not sweep the raise into it) while keeping the stored percent
   * an accurate description of "what % of current income this is" rather
   * than a stale figure computed against a smaller pool.
   * allocation_percent is decimal(6,3) — rounded to 3 decimals, which at
   * typical pool sizes is sub-dollar precision (accepted trade-off; see
   * recalculateAllocation for the shared live-pool computation this reuses).
   */
  lockInAllocationPercent: savingsProcedure
    .input(
      z
        .object({
          goalId: z.number().int().optional(),
          profileId: z.number().int().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const [goals, targetProfile] = await Promise.all([
        ctx.db.select().from(schema.savingsGoals),
        resolveTargetBudgetProfile(ctx.db, input?.profileId),
      ]);
      const targetProfileId = targetProfile?.id;
      if (targetProfileId === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile to recalculate against",
        });
      }

      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        goals,
        targetProfileId,
      );
      const targets = goals.filter(
        (g) =>
          g.isActive &&
          resolvedByGoal.get(g.id)?.allocationPercent != null &&
          (input?.goalId === undefined || g.id === input.goalId),
      );
      if (targets.length === 0) return { updated: 0 };

      const maxMonthlyFunding = await computeLiveMaxMonthlyFunding(
        ctx,
        targetProfileId,
      );
      if (maxMonthlyFunding === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No live paycheck/budget data available to recalculate from",
        });
      }
      if (maxMonthlyFunding <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current income pool is zero or negative — can't compute a percent",
        });
      }

      await ctx.db.transaction(async (tx) => {
        for (const g of targets) {
          const resolved = resolvedByGoal.get(g.id)!;
          const newPercent =
            (resolved.monthlyContribution / maxMonthlyFunding) * 100;
          await upsertGoalProfileAllocation(tx, g.id, targetProfileId, {
            allocationPercent: newPercent,
            monthlyContribution: resolved.monthlyContribution,
          });
        }
      });

      return { updated: targets.length };
    }),

  // ══ REIMBURSEMENT CATEGORY ══

  /** Link a reimbursement tracking category to the e-fund goal. */
  linkReimbursementCategory: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        apiCategoryId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({ reimbursementApiCategoryId: input.apiCategoryId })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  /** Get parsed reimbursement items from the linked YNAB category's note field. */
  listEfundReimbursements: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return null;

    // Find the e-fund goal with a linked reimbursement category
    const goals = await ctx.db.select().from(schema.savingsGoals);
    const efundGoal = goals.find(
      (g) => g.isEmergencyFund && g.reimbursementApiCategoryId,
    );
    if (!efundGoal) return null;

    const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
      ctx.db,
      active,
      "categories",
    );
    if (!categoriesCache) return null;

    // Find the reimbursement category in cache
    let reimbursementCat: {
      name: string;
      note?: string | null;
      balance: number;
      goalTarget?: number;
    } | null = null;
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        if (cat.id === efundGoal.reimbursementApiCategoryId) {
          reimbursementCat = cat;
          break;
        }
      }
      if (reimbursementCat) break;
    }
    if (!reimbursementCat) return null;

    // Parse note field: each line = "amount - description"
    // Supports: "50 - lunch", "1,200 — hotel", "$50.00 - taxi"
    const items: { amount: number; description: string }[] = [];
    const skippedLines: string[] = [];
    if (reimbursementCat.note) {
      for (const line of reimbursementCat.note.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^\$?([\d,.]+)\s*[-–—]\s*(.+)$/);
        if (match) {
          const amount = parseFloat(match[1]!.replace(/,/g, ""));
          if (!isNaN(amount) && amount > 0) {
            items.push({ amount, description: match[2]!.trim() });
          } else {
            skippedLines.push(trimmed);
          }
        } else {
          skippedLines.push(trimmed);
        }
      }
    }

    const total = items.reduce((s, i) => s + i.amount, 0);

    return {
      items,
      total,
      balance: reimbursementCat.balance,
      target: reimbursementCat.goalTarget ?? 0,
      categoryName: reimbursementCat.name,
      skippedLines: skippedLines.length > 0 ? skippedLines : undefined,
    };
  }),

  // ══ TRANSFERS (paired planned transactions) ══
  transfers: createTRPCRouter({
    create: savingsProcedure
      .input(
        z.object({
          fromGoalId: z.number().int(),
          toGoalId: z.number().int(),
          transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: z.number().positive(),
          description: z.string().min(1),
          isRecurring: z.boolean().default(false),
          recurrenceMonths: z.number().int().min(1).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const pairId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const base = {
          transactionDate: input.transactionDate,
          description: input.description,
          isRecurring: input.isRecurring,
          recurrenceMonths: input.recurrenceMonths ?? null,
          transferPairId: pairId,
        };
        const [withdrawal, deposit] = await Promise.all([
          ctx.db
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.fromGoalId,
              amount: String(-input.amount),
            })
            .returning()
            .then((r) => r[0]),
          ctx.db
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.toGoalId,
              amount: String(input.amount),
            })
            .returning()
            .then((r) => r[0]),
        ]);
        return { pairId, withdrawal, deposit };
      }),
    delete: savingsProcedure
      .input(z.object({ transferPairId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(
            eq(
              schema.savingsPlannedTransactions.transferPairId,
              input.transferPairId,
            ),
          );
        return { ok: true };
      }),
  }),

  // ══ EXTRA PAYCHECK ROUTING ══
  extraPaycheckRouting: createTRPCRouter({
    /** Load routing rules for all jobs. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const jobs = await ctx.db
        .select({
          id: schema.jobs.id,
          personId: schema.jobs.personId,
          employerName: schema.jobs.employerName,
          payPeriod: schema.jobs.payPeriod,
          anchorPayDate: schema.jobs.anchorPayDate,
          extraPaycheckRouting: schema.jobs.extraPaycheckRouting,
        })
        .from(schema.jobs)
        .where(
          and(
            isNull(schema.jobs.endDate),
            eq(schema.jobs.isSpeculative, false),
          ),
        )
        .orderBy(asc(schema.jobs.personId), asc(schema.jobs.id));
      const people = await ctx.db
        .select({ id: schema.people.id, name: schema.people.name })
        .from(schema.people);
      const personMap = new Map(people.map((p) => [p.id, p.name]));
      return jobs.map((j) => ({
        ...j,
        personName: personMap.get(j.personId) ?? "Unknown",
      }));
    }),

    /** Save routing rules for a single job and re-materialize. Preserves existing overrides and growth settings. */
    save: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          rules: z.array(
            z.object({
              from: z.string().regex(/^\d{4}-\d{2}$/),
              to: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .nullable(),
              splits: z.array(
                z.object({
                  goalId: z.number().int(),
                  pct: z.number().min(0).max(100),
                }),
              ),
            }),
          ),
          /** Per-year growth rates; keyed by year string e.g. "2027". */
          yearlyGrowth: z
            .record(
              z.string(),
              z.object({ type: z.enum(["pct", "dollar"]), value: z.number() }),
            )
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Validate: splits for each rule must sum to 100
        for (const rule of input.rules) {
          const total = rule.splits.reduce((s, sp) => s + sp.pct, 0);
          if (Math.abs(total - 100) > 0.01) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Rule starting ${rule.from}: splits must sum to 100% (got ${total.toFixed(1)}%)`,
            });
          }
          // Validate no overlapping date ranges
          for (const other of input.rules) {
            if (other === rule) continue;
            const aEnd = rule.to ?? "9999-12";
            const bEnd = other.to ?? "9999-12";
            if (rule.from <= bEnd && other.from <= aEnd) {
              if (rule.from !== other.from) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Rules overlap: ${rule.from}–${rule.to ?? "∞"} and ${other.from}–${other.to ?? "∞"}`,
                });
              }
            }
          }
        }

        // Preserve existing overrides and growth settings when saving rules
        const [existingJob] = await ctx.db
          .select({ extraPaycheckRouting: schema.jobs.extraPaycheckRouting })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, input.jobId));
        const existing = existingJob?.extraPaycheckRouting;
        const existingOverrides = existing?.overrides ?? [];

        // Always recompute net pay from the paycheck calculator — never trust a client-supplied value.
        const baseNetPayPerCheck = await computeJobNetPayPerCheck(
          ctx.db,
          input.jobId,
        );
        const nowYear = new Date().getFullYear();
        await ctx.db
          .update(schema.jobs)
          .set({
            extraPaycheckRouting:
              input.rules.length > 0
                ? {
                    rules: input.rules,
                    overrides: existingOverrides,
                    baseNetPayPerCheck,
                    baseYear: nowYear,
                    yearlyGrowth:
                      input.yearlyGrowth !== undefined
                        ? input.yearlyGrowth
                        : existing?.yearlyGrowth,
                  }
                : null,
          })
          .where(eq(schema.jobs.id, input.jobId));

        await materializeExtraPaycheckOverrides(ctx.db);
        return { ok: true };
      }),

    /** Persist growth rates for a job, then re-materialize. Net pay is always recomputed server-side. */
    saveGrowth: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          yearlyGrowth: z.record(
            z.string(),
            z.object({ type: z.enum(["pct", "dollar"]), value: z.number() }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [existingJob] = await ctx.db
          .select({ extraPaycheckRouting: schema.jobs.extraPaycheckRouting })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, input.jobId));
        if (!existingJob?.extraPaycheckRouting) return { ok: true };

        const baseNetPayPerCheck = await computeJobNetPayPerCheck(
          ctx.db,
          input.jobId,
        );
        const nowYear = new Date().getFullYear();
        await ctx.db
          .update(schema.jobs)
          .set({
            extraPaycheckRouting: {
              ...existingJob.extraPaycheckRouting,
              baseNetPayPerCheck,
              baseYear: nowYear,
              yearlyGrowth: input.yearlyGrowth,
            },
          })
          .where(eq(schema.jobs.id, input.jobId));

        await materializeExtraPaycheckOverrides(ctx.db);
        return { ok: true };
      }),

    /** Upsert or delete a one-time override for a specific extra-paycheck month. */
    saveOverride: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          month: z.string().regex(/^\d{4}-\d{2}$/),
          splits: z
            .array(
              z.object({
                goalId: z.number().int(),
                pct: z.number().min(0).max(100),
              }),
            )
            .nullable(), // null = delete the override
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.splits !== null) {
          const total = input.splits.reduce((s, sp) => s + sp.pct, 0);
          if (Math.abs(total - 100) > 0.01) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Override splits must sum to 100% (got ${total.toFixed(1)}%)`,
            });
          }
        }

        const [job] = await ctx.db
          .select({ extraPaycheckRouting: schema.jobs.extraPaycheckRouting })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, input.jobId));
        if (!job?.extraPaycheckRouting) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No routing rules for this job",
          });
        }

        const routing = job.extraPaycheckRouting;
        let overrides = routing.overrides ?? [];

        if (input.splits === null) {
          overrides = overrides.filter((o) => o.month !== input.month);
        } else {
          const exists = overrides.some((o) => o.month === input.month);
          if (exists) {
            overrides = overrides.map((o) =>
              o.month === input.month ? { ...o, splits: input.splits! } : o,
            );
          } else {
            overrides = [
              ...overrides,
              { month: input.month, splits: input.splits },
            ];
          }
        }

        await ctx.db
          .update(schema.jobs)
          .set({ extraPaycheckRouting: { ...routing, overrides } })
          .where(eq(schema.jobs.id, input.jobId));

        await materializeExtraPaycheckOverrides(ctx.db);
        return { ok: true };
      }),

    /** Re-run materializer without changing rules (e.g. after goal rename). */
    rematerialize: savingsProcedure.mutation(async ({ ctx }) => {
      await materializeExtraPaycheckOverrides(ctx.db);
      return { ok: true };
    }),
  }),

  /** All recorded monthly balances for active savings goals (for history view). */
  getMonthlyHistory: protectedProcedure.query(async ({ ctx }) => {
    const activeGoals = await ctx.db
      .select({ id: schema.savingsGoals.id })
      .from(schema.savingsGoals)
      .where(eq(schema.savingsGoals.isActive, true));

    if (activeGoals.length === 0) return { rows: [] };

    const { isPostgres } = await import("@/lib/db/dialect");
    const { queryRaw } = await import("@/lib/db/compat");
    const ids = activeGoals.map((g) => g.id);
    const inList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

    type MonthlyRow = { goal_id: number; month_date: string; balance: number };
    const rows = isPostgres()
      ? await queryRaw<MonthlyRow>(
          ctx.db,
          sql`
          SELECT goal_id, month_date::text, balance::numeric
          FROM savings_monthly
          WHERE goal_id IN (${inList})
          ORDER BY month_date ASC
        `,
        )
      : await queryRaw<MonthlyRow>(
          ctx.db,
          sql`
          SELECT goal_id, month_date, CAST(balance AS REAL) AS balance
          FROM savings_monthly
          WHERE goal_id IN (${inList})
          ORDER BY month_date ASC
        `,
        );

    return {
      rows: rows.map((r) => ({
        goalId: r.goal_id,
        monthDate: r.month_date,
        balance: Number(r.balance),
      })),
    };
  }),

  savingsGoals: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.savingsGoals)
        .orderBy(asc(schema.savingsGoals.priority)),
    ),
    create: savingsProcedure
      .input(savingsGoalInput)
      .mutation(async ({ ctx, input }) => {
        const goal = await ctx.db
          .insert(schema.savingsGoals)
          .values(input)
          .returning()
          .then((r) => r[0]!);
        // Funding is per-profile with no shared default — every existing
        // budget profile needs an explicit $0/no-percent row for this new
        // goal (see savings_goal_profile_allocations' table comment).
        const profiles = await ctx.db
          .select({ id: schema.budgetProfiles.id })
          .from(schema.budgetProfiles);
        if (profiles.length > 0) {
          await ctx.db.insert(schema.savingsGoalProfileAllocations).values(
            profiles.map((p) => ({
              goalId: goal.id,
              budgetProfileId: p.id,
              allocationPercent: null,
              monthlyContribution: "0",
            })),
          );
        }
        return goal;
      }),
    update: savingsProcedure
      .input(z.object({ id: z.number().int() }).extend(savingsGoalInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.savingsGoals)
          .set(data)
          .where(eq(schema.savingsGoals.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.savingsGoals)
          .where(eq(schema.savingsGoals.id, input.id)),
      ),
  }),
});
