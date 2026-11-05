/** Milestones router — the year-level history and saved choices the
 *  Milestones engine (lib/pure/advice/milestones/milestones.ts) reads. Judging happens in the
 *  pure engine; this only fetches and maps. */
import { eq, inArray } from "drizzle-orm";
import type { z } from "zod/v4";
import {
  createCallerFactory,
  createTRPCRouter,
  internalCtx,
  protectedProcedure,
  type Context,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { buildYearEndHistory } from "@/server/helpers";
import { wealthFormulaIncome } from "@/lib/pure/net-worth/net-worth";
import {
  SK_EFUND_BUDGET_COLUMN,
  SK_HIGH_INCOME_THRESHOLD,
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_FIRST_REACHED,
  SK_MILESTONE_CHECKPOINT_SOURCE,
  SK_MILESTONE_CUSTOM_GOALS,
  SK_MILESTONE_SAVINGS_TARGET_SOURCE,
} from "@/lib/constants/settings-keys";
import {
  evaluateMilestones,
  parseMilestoneSettings,
} from "@/lib/pure/advice/milestones/milestones";
import {
  buildMilestoneInput,
  milestoneYearFromHistory,
} from "@/lib/pure/advice/milestones/input";
import {
  mergeFirstReached,
  parseFirstReached,
} from "@/lib/pure/advice/milestone-first-reached";
import { effectiveHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { householdHighIncomeLine } from "@/server/helpers/high-income-line";
import { mergeSettingAtomically } from "@/server/helpers/merge-setting";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { contributionRouter } from "./contribution";
import { savingsRouter } from "./savings";
import { mortgageRouter } from "./mortgage";
import { investmentsRouter } from "./investments";
import { brokerageRouter } from "./brokerage";
import { zYearEndTargeting } from "./_shared";
import type { MilestoneDebt } from "@/lib/pure/advice/milestones/milestones";
import { debtPayoffEstimate } from "@/lib/pure/debts/debts";
import { raiseHistory } from "@/lib/pure/household/raise-history";
import { downYears } from "@/lib/pure/investments/always-buying";
import { firstFullSalary } from "@/lib/pure/debts/debt-rules";
import { parseEstimatedFields } from "@/lib/pure/investments/performance-annotations";
import { getAge, localDateStr } from "@/lib/utils/date";
import { toNumber } from "@/lib/utils/numbers";
import {
  debtBalance,
  getEffectiveOtherLiabilities,
  isOpenDebt,
} from "@/server/helpers/debts";

/** Each past year whose Performance rows are all finalized: the
 *  household's own contributions (every account, employer money out), its
 *  recorded investment gain, and whether contributions are still estimated.
 *  What the 60/40 and Always Be Buying rules compare year to year. */
function finalizedYears(
  perfRows: readonly {
    year: number;
    totalContributions: string;
    employerContributions: string;
    yearlyGainLoss: string;
    isFinalized: boolean;
    estimatedFields: unknown;
  }[],
  asOfYear: number,
) {
  const years = new Map<
    number,
    { employee: number; gain: number; estimated: boolean; finalized: boolean }
  >();
  for (const r of perfRows) {
    if (r.year >= asOfYear) continue;
    const y = years.get(r.year) ?? {
      employee: 0,
      gain: 0,
      estimated: false,
      finalized: true,
    };
    const est = parseEstimatedFields(r.estimatedFields);
    years.set(r.year, {
      employee:
        y.employee +
        toNumber(r.totalContributions) -
        toNumber(r.employerContributions),
      gain: y.gain + toNumber(r.yearlyGainLoss),
      estimated:
        y.estimated ||
        est.includes("employeeContrib") ||
        est.includes("employerContributions"),
      finalized: y.finalized && r.isFinalized,
    });
  }
  for (const [year, y] of years) if (!y.finalized) years.delete(year);
  return years;
}

/** The borrowing rules' inputs: open car loans, and each person's student
 *  loans (paid off or not) with the first full salary they're judged
 *  against (lib/pure/debts/debt-rules.ts). */
function borrowingFrom(
  debtRows: (typeof schema.debts.$inferSelect)[],
  people: readonly { id: number; name: string }[],
  salaryRows: readonly { personId: number; year: number; salary: string }[],
  jobRows: readonly {
    personId: number;
    startDate: string;
    endDate: string | null;
  }[],
  today: string,
) {
  const num = (v: string | null) => (v == null ? null : toNumber(v));
  const carLoans = debtRows
    .filter((d) => d.kind === "auto_loan" && isOpenDebt(d, today))
    .map((d) => ({
      name: d.name,
      purchasePrice: num(d.purchasePrice),
      originalAmount: num(d.originalAmount),
      termMonths: d.termMonths,
      monthlyPayment: num(d.monthlyPayment),
    }));
  const student = debtRows.filter((d) => d.kind === "student_loan");
  const studentLoans = people.flatMap((p) => {
    const mine = student.filter((d) => d.ownerPersonId === p.id);
    if (mine.length === 0) return [];
    const years = mine
      .map((d) => (d.openedDate ? Number(d.openedDate.slice(0, 4)) : null))
      .filter((y): y is number => y !== null);
    const loanYear = years.length > 0 ? Math.min(...years) : null;
    return [
      {
        owner: p.name,
        totalOriginal: mine.every((d) => d.originalAmount != null)
          ? mine.reduce((s, d) => s + toNumber(d.originalAmount!), 0)
          : null,
        loanYear,
        firstSalary:
          loanYear === null
            ? null
            : firstFullSalary(
                salaryRows
                  .filter((r) => r.personId === p.id)
                  .map((r) => ({ year: r.year, salary: toNumber(r.salary) })),
                jobRows.filter((j) => j.personId === p.id),
                loanYear,
              ),
      },
    ];
  });
  return {
    carLoans,
    studentLoans,
    jointStudentLoans: student.filter((d) => d.ownerPersonId == null).length,
  };
}

/** Household salary a year (past years). */
function salaryByYear(
  salaryRows: readonly { year: number; salary: string }[],
  asOfYear: number,
) {
  const salary = new Map<number, number>();
  for (const r of salaryRows)
    if (r.year < asOfYear)
      salary.set(r.year, (salary.get(r.year) ?? 0) + toNumber(r.salary));
  return salary;
}

/** Year-end history mapped for the Milestones engine, plus the household's
 *  own goals and checklist. */
async function loadMilestoneInputs(
  db: Context["db"],
  input: z.infer<typeof zYearEndTargeting>,
) {
  const asOfDate = new Date();
  const [
    history,
    settingRows,
    debtRows,
    people,
    otherDebt,
    salaryRows,
    perfRows,
    jobRows,
  ] = await Promise.all([
    buildYearEndHistory(db, asOfDate, {
      budgetProfileId: input?.budgetProfileId,
      budgetColumn: input?.budgetColumn,
    }),
    db
      .select()
      .from(schema.appSettings)
      .where(
        inArray(schema.appSettings.key, [
          SK_MILESTONE_CUSTOM_GOALS,
          SK_MILESTONE_CHECKLIST,
          SK_MILESTONE_CHECKPOINT_SOURCE,
          SK_MILESTONE_SAVINGS_TARGET_SOURCE,
        ]),
      ),
    db.select().from(schema.debts),
    db.select().from(schema.people),
    getEffectiveOtherLiabilities(db),
    db.select().from(schema.historicalSalaries),
    db
      .select({
        year: schema.accountPerformance.year,
        totalContributions: schema.accountPerformance.totalContributions,
        employerContributions: schema.accountPerformance.employerContributions,
        yearlyGainLoss: schema.accountPerformance.yearlyGainLoss,
        isFinalized: schema.accountPerformance.isFinalized,
        estimatedFields: schema.accountPerformance.estimatedFields,
      })
      .from(schema.accountPerformance),
    db
      .select({
        personId: schema.jobs.personId,
        startDate: schema.jobs.startDate,
        endDate: schema.jobs.endDate,
      })
      .from(schema.jobs)
      // The speculative what-if job isn't pay on record.
      .where(eq(schema.jobs.isSpeculative, false)),
  ]);
  const setting = (key: string) =>
    settingRows.find((r) => r.key === key)?.value ?? null;
  const asOfYear = asOfDate.getFullYear();
  const ownYears = finalizedYears(perfRows, asOfYear);
  const current =
    history.find((h) => h.isCurrent) ?? history[history.length - 1];
  // Each debt judged at its owner's age today, by birthday (a joint
  // debt: the household's average age, as every other milestone uses —
  // 0, the most lenient band, only when there are no people at all).
  const today = localDateStr(asOfDate);
  const householdAge = current?.averageAge ?? 0;
  const ageOf = (personId: number | null) => {
    const p = people.find((x) => x.id === personId);
    return p
      ? getAge(new Date(`${p.dateOfBirth}T00:00:00`), asOfDate)
      : householdAge;
  };
  const debts: MilestoneDebt[] = debtRows.map((d) => {
    const now = debtBalance(d);
    const balance = now.balance;
    const rate = d.interestRate == null ? null : toNumber(d.interestRate);
    const open = isOpenDebt(d, today);
    const est = debtPayoffEstimate(
      {
        balance,
        interestRate: rate,
        monthlyPayment:
          d.monthlyPayment == null ? null : toNumber(d.monthlyPayment),
        balanceAsOf: now.asOf,
      },
      today,
    );
    return {
      name: d.name,
      kind: d.kind,
      balance,
      rate,
      ownerAge: ageOf(d.ownerPersonId),
      open,
      payoffYear: est.payoffMonth ? Number(est.payoffMonth.slice(0, 4)) : null,
      never: est.never,
      stale: open && est.stale,
      paidOffYear: d.paidOffDate ? Number(d.paidOffDate.slice(0, 4)) : null,
    };
  });
  return {
    asOfYear: asOfDate.getFullYear(),
    raises: raiseHistory(salaryByYear(salaryRows, asOfYear), ownYears),
    downYears: downYears(ownYears),
    borrowing: borrowingFrom(debtRows, people, salaryRows, jobRows, today),
    years: history.map((row) =>
      milestoneYearFromHistory({
        ...row,
        grossIncome: wealthFormulaIncome(row),
      }),
    ),
    fiTarget: current?.fiTarget ?? 0,
    debts,
    otherDebt: {
      manual: otherDebt.manual,
      creditCardMapped: otherDebt.creditCardMapped,
    },
    ...parseMilestoneSettings({
      customGoals: setting(SK_MILESTONE_CUSTOM_GOALS),
      checklist: setting(SK_MILESTONE_CHECKLIST),
      checkpointSource: setting(SK_MILESTONE_CHECKPOINT_SOURCE),
      savingsTargetSource: setting(SK_MILESTONE_SAVINGS_TARGET_SOURCE),
    }),
  };
}

export const milestonesRouter = createTRPCRouter({
  /** Year-end history mapped for the Milestones engine, plus the household's own goals and checklist. */
  computeInputs: protectedProcedure
    .input(zYearEndTargeting)
    .query(({ ctx, input }) => loadMilestoneInputs(ctx.db, input)),

  /** When each milestone was first reached (null before any recording). */
  firstReached: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_MILESTONE_FIRST_REACHED));
    return parseFirstReached(row?.value);
  }),

  /**
   * Record milestones reached now that aren't recorded yet. Judged here, on
   * the active profiles — never on what a page shows (it may be a What-If)
   * or on ids a browser sends. Any signed-in viewer's visit can record;
   * nothing goes to the change log (it's the app's own bookkeeping), and a
   * demo never records.
   */
  recordReached: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.demoSchema) return null;
    const results = evaluateMilestones(
      await activeMilestoneInput(ctx as Context),
    );
    const today = ctx.scope.today;
    const reachedNow = results
      .filter((r) => r.status === "reached")
      .map((r) => ({ id: r.id, reachedYear: r.reachedYear }));
    return mergeSettingAtomically(ctx.db, SK_MILESTONE_FIRST_REACHED, (raw) =>
      mergeFirstReached(parseFirstReached(raw), reachedNow, today),
    );
  }),
});

/** The milestone input on the active profiles, as the server sees it —
 *  no projection (reached never depends on it); holdings and brokerage
 *  goals when this viewer may see them. */
async function activeMilestoneInput(ctx: Context) {
  const inner = internalCtx(ctx);
  const settingRows = await ctx.db
    .select()
    .from(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        SK_EFUND_BUDGET_COLUMN,
        SK_HIGH_INCOME_THRESHOLD,
      ]),
    );
  const setting = (key: string) =>
    settingRows.find((r) => r.key === key)?.value ?? null;
  const efundColumn = setting(SK_EFUND_BUDGET_COLUMN);
  const optional = <T>(p: Promise<T>) => p.catch(() => null);
  // Contributions need the profile ids the page sends; with none they're $0.
  const { contribProfileId, salaryProfileId } =
    await resolveProfileSelection(ctx);
  const [
    inputs,
    contributions,
    savings,
    mortgage,
    holdings,
    buyingMonths,
    goals,
    line,
  ] = await Promise.all([
    loadMilestoneInputs(ctx.db, undefined),
    createCallerFactory(contributionRouter)(inner).computeSummary({
      ...(contribProfileId != null
        ? { contributionProfileId: contribProfileId }
        : {}),
      ...(salaryProfileId != null ? { salaryProfileId } : {}),
    }),
    createCallerFactory(savingsRouter)(inner).computeSummary(
      typeof efundColumn === "number" && efundColumn >= 0
        ? { budgetTierOverride: efundColumn }
        : undefined,
    ),
    createCallerFactory(mortgageRouter)(inner).computeActiveSummary(),
    optional(
      createCallerFactory(investmentsRouter)(inner).getHoldingsOverview(),
    ),
    optional(createCallerFactory(investmentsRouter)(inner).getBuyingMonths()),
    optional(createCallerFactory(brokerageRouter)(inner).listGoals()),
    householdHighIncomeLine(ctx.db),
  ]);
  const efund = savings.efund;
  return buildMilestoneInput({
    inputs,
    contributions,
    highIncomeThreshold: effectiveHighIncomeLine(
      setting(SK_HIGH_INCOME_THRESHOLD),
      line.threshold,
    ),
    efundMonths: efund
      ? (efund.monthsCoveredWithRepay ?? efund.monthsCovered)
      : null,
    efundEssentialMonthly:
      efund && efund.targetMonths > 0
        ? efund.targetAmount / efund.targetMonths
        : null,
    mortgage,
    projection: null,
    holdings,
    buyingMonths,
    brokerageGoals:
      goals?.map((g) => ({ name: g.name, targetYear: g.targetYear })) ?? null,
  });
}
