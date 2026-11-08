import { eq, inArray } from "drizzle-orm";
import type { z } from "zod/v4";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { log } from "@/lib/logger";
import { effectiveHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { householdHighIncomeLine } from "@/server/services/paycheck/high-income-line";
import {
  resolveProfileSelection,
  summaryProfileIdsInput,
} from "@/server/services/profile-selection";
import { computeContributionSummary } from "@/server/services/contributions/summary";
import { computeSavingsSummary } from "@/server/services/savings/summary";
import { computeMortgageActiveSummary } from "@/server/services/mortgage/active-summary";
import { loadHoldingsOverview } from "@/server/services/investments/holdings-overview";
import { loadBuyingMonths } from "@/server/services/investments/buying-months";
import { listBrokerageGoals } from "@/server/data/brokerage-goals";
import { buildYearEndHistory } from "@/server/services/net-worth/year-end-history";
import { wealthFormulaIncome } from "@/lib/pure/net-worth/net-worth";
import {
  SK_EFUND_BUDGET_COLUMN,
  SK_HIGH_INCOME_THRESHOLD,
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_CHECKPOINT_SOURCE,
  SK_MILESTONE_CUSTOM_GOALS,
  SK_MILESTONE_SAVINGS_TARGET_SOURCE,
} from "@/lib/constants/settings-keys";
import { parseMilestoneSettings } from "@/lib/pure/advice/milestones/milestones";
import {
  buildMilestoneInput,
  milestoneYearFromHistory,
} from "@/lib/pure/advice/milestones/input";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import type { MilestoneDebt } from "@/lib/pure/advice/milestones/milestones";
import { debtPayoffEstimate } from "@/lib/pure/debts/debts";
import { raiseHistory } from "@/lib/pure/household/raise-history";
import { downYears } from "@/lib/pure/investments/always-buying";
import { firstFullSalary } from "@/lib/pure/debts/debt-rules";
import { parseEstimatedFields } from "@/lib/pure/investments/performance-annotations";
import { getAge } from "@/lib/utils/date";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { toNumber, toNumberOrNull } from "@/lib/utils/numbers";
import { debtBalance, isOpenDebt } from "@/lib/pure/debts/debt-balance";
import { getEffectiveOtherLiabilities } from "@/server/services/debts/other-liabilities";

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
  const carLoans = debtRows
    .filter((d) => d.kind === "auto_loan" && isOpenDebt(d, today))
    .map((d) => ({
      name: d.name,
      purchasePrice: toNumberOrNull(d.purchasePrice),
      originalAmount: toNumberOrNull(d.originalAmount),
      termMonths: d.termMonths,
      monthlyPayment: toNumberOrNull(d.monthlyPayment),
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
export async function loadMilestoneInputs(
  { db, scope }: { db: Db; scope: RequestScope },
  input: z.infer<typeof zYearEndTargeting>,
) {
  const asOfDate = scope.asOf;
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
    getEffectiveOtherLiabilities(db, { asOf: asOfDate }),
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
  const today = calendarDateOf(asOfDate);
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
    const rate = toNumberOrNull(d.interestRate);
    const open = isOpenDebt(d, today);
    const est = debtPayoffEstimate(
      {
        balance,
        interestRate: rate,
        monthlyPayment: toNumberOrNull(d.monthlyPayment),
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

/** A read the milestone input can go without: null on error, with a warning. */
function orNull<T>(read: string, p: Promise<T>): Promise<T | null> {
  return p.catch((err: unknown) => {
    log("warn", "milestones.active_input_read_failed", {
      read,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
}

/** The milestone input on the active profiles, as the server sees it — no
 *  projection (reached never depends on it). Holdings and buying months
 *  need the portfolio permission; brokerage goals are read for every viewer. */
export async function activeMilestoneInput(ctx: {
  db: Db;
  scope: RequestScope;
}) {
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
  const portfolio = ctx.scope.can("portfolio");
  // Contributions need the profile ids the page sends; with none they're $0.
  const profileIds = summaryProfileIdsInput(await resolveProfileSelection(ctx));
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
    loadMilestoneInputs(ctx, undefined),
    computeContributionSummary(ctx, profileIds),
    computeSavingsSummary(
      ctx,
      typeof efundColumn === "number" && efundColumn >= 0
        ? { budgetTierOverride: efundColumn }
        : undefined,
    ),
    computeMortgageActiveSummary(ctx),
    portfolio
      ? orNull("holdings", loadHoldingsOverview(ctx.db, ctx.scope.asOf))
      : null,
    portfolio ? orNull("buyingMonths", loadBuyingMonths(ctx)) : null,
    orNull("brokerageGoals", listBrokerageGoals(ctx)),
    householdHighIncomeLine(ctx.db, ctx.scope.asOf),
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
