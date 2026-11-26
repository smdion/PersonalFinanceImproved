/**
 * buildProjectionState — initializes mutable projection state.
 */
import { seedBrokerageBasis } from "../brokerage-basis";
import type { ProjectionInput } from "../types/projection-result";
import { isPreTaxType, isTaxFreeBucket } from "../../../config/account-types";
import { openingTotals } from "../opening-parts";
import { rmdOwnerOf } from "../rmd-enforcement";
import { initialCrossYearState } from "../spending-strategy";
import {
  buildSpecToAccountMapping,
  type SpecParts,
} from "../individual-accounts/spec-accounts";
import { initRothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { ProjectionContext, ProjectionLoopState } from "./types";
import { perOwnerRmds } from "./helpers";
import type { YearIncome } from "@/lib/pure/tax/year-income";

/**
 * Initialize mutable projection state from input and context.
 */
export function buildProjectionState(
  input: ProjectionInput,
  ctx: ProjectionContext,
): ProjectionLoopState {
  // Mutable copy of accumulation defaults -- profile switches may update contributionRate
  const accumulationDefaults = { ...input.accumulationDefaults };

  // Clone contribution specs so salaryFraction updates don't mutate caller's input
  const contributionSpecs = input.contributionSpecs?.map((s) => ({ ...s }));

  // Active references for profile switching: pre-year-setup replaces them on
  // a switch but never mutates the objects, so no clone is needed unless a
  // handler writes into them.
  const activeEmployerMatchRateByCategory = input.employerMatchRateByCategory;
  const activeBaseYearContributions = input.baseYearContributions;
  const activeBaseYearEmployerMatch = input.baseYearEmployerMatch;
  const activeEmployerMatchByParentCat = input.employerMatchByParentCat;

  // Running balances: the per-category balances and the tax buckets the
  // opening parts hold (the one starting input).
  const { accountBalance, balances } = openingTotals(input.individualAccounts);

  // RMD tracking: prior year-end Traditional balance (used to compute RMD for current year)
  // Initialized from starting balances -- sum of all Traditional (pre-tax) across accounts.
  const priorYearEndTradBalance = balances.preTax;

  // Per-person Traditional balance for per-person RMD (from individual accounts)
  const priorYearEndTradByPerson = new Map<number, number>();
  if (perOwnerRmds(ctx)) {
    for (const ia of ctx.indAccounts) {
      const owner = rmdOwnerOf(ia, ctx.primaryPersonId);
      if (owner != null && isPreTaxType(ia.taxType)) {
        const prev = priorYearEndTradByPerson.get(owner) ?? 0;
        priorYearEndTradByPerson.set(owner, prev + ia.startingBalance);
      }
    }
  }

  // Spending strategy cross-year state
  const spendingState = initialCrossYearState();

  // Each decumulation year's income, for the senior deduction's lookback
  const incomeHistory: YearIncome[] = [];

  // Individual account balances
  const indBalance = new Map<string, number>();
  for (const ia of ctx.indAccounts)
    indBalance.set(ctx.indKey(ia), ia.startingBalance);

  // Tracked Roth basis: one entry per taxFree-bucket account, seeded from
  // its rothBasisMeta snapshot; non-Roth accounts get no entry (not zero).
  const indBasis = new Map<string, RothBasisState>();
  const projectionStartYear = input.asOfDate.getFullYear();
  for (const ia of ctx.indAccounts) {
    if (!isTaxFreeBucket(ia.taxType)) continue;
    indBasis.set(
      ctx.indKey(ia),
      initRothBasisState(ia.rothBasisMeta ?? null, projectionStartYear),
    );
  }

  // Brokerage cost basis per account (each account's own starting basis).
  const brokBasis = seedBrokerageBasis(
    ctx.indAccounts,
    ctx.indKey,
    balances.afterTaxBasis,
  );

  const { specToAccount, accountsWithSpecs } =
    ctx.ledgerRuns && contributionSpecs
      ? buildSpecToAccountMapping(
          contributionSpecs,
          ctx.indAccounts,
          ctx.indKey,
        )
      : {
          specToAccount: new Map<string, SpecParts>(),
          accountsWithSpecs: new Set<string>(),
        };

  // Per-person salary tracking (when salaryByPerson is provided)
  const projectedSalaryByPerson = new Map<number, number>();
  if (ctx.hasPerPersonSalary) {
    for (const [pid, salary] of Object.entries(input.salaryByPerson!)) {
      projectedSalaryByPerson.set(Number(pid), salary);
    }
  }

  return {
    balances,
    accountBalance,
    priorYearEndTradBalance,
    priorYearEndTradByPerson,
    projectedSalary: input.currentSalary,
    projectedExpenses: input.annualExpenses,
    budgetOnlyExpenses: input.annualExpenses,
    portfolioWithdrawal: null,
    projectedSalaryByPerson,
    indBalance,
    indBasis,
    brokBasis,
    specToAccount,
    accountsWithSpecs,
    contributionSpecs,
    activeEmployerMatchRateByCategory,
    activeBaseYearContributions,
    activeBaseYearEmployerMatch,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    spendingState,
    incomeHistory,
    irmaaTaxYears: new Map(),
    rmdNoOwnerWarned: false,
    decumulationExpensesSet: false,
    firstDecumulationYearStatedNeed: null,
    firstOverflowYear: null,
    firstOverflowAge: null,
    firstOverflowAmount: null,
    retirementDepletionYear: null,
    retirementDepletionAge: null,
    accountDepletions: [],
    depletionTracked: new Set<string>(),
    projectionByYear: [],
  };
}
