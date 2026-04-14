/**
 * buildProjectionState — initializes mutable projection state.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 refactor. Pure relocation — no logic changes.
 */
import type { ProjectionInput, AccountBalances, TaxBuckets } from "../../types";
import { isPreTaxType } from "../../../config/account-types";
import {
  accountBalancesFromTaxBuckets,
  cloneAccountBalances,
} from "../balance-utils";
import { initialCrossYearState } from "../spending-strategy";
import { buildSpecToAccountMapping } from "../individual-account-tracking";
import type { ProjectionContext, ProjectionLoopState } from "./types";

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

  // Mutable active references for profile switching
  const activeEmployerMatchRateByCategory = input.employerMatchRateByCategory;
  const activeBaseYearContributions = input.baseYearContributions;
  const activeBaseYearEmployerMatch = input.baseYearEmployerMatch;
  const activeEmployerMatchByParentCat = input.employerMatchByParentCat;

  // Running balances -- AccountBalances is the source of truth;
  // TaxBuckets is derived for backward compatibility.
  const acctBal: AccountBalances = input.startingAccountBalances
    ? cloneAccountBalances(input.startingAccountBalances)
    : accountBalancesFromTaxBuckets(input.startingBalances);
  const balances: TaxBuckets = { ...input.startingBalances };

  // RMD tracking: prior year-end Traditional balance (used to compute RMD for current year)
  // Initialized from starting balances -- sum of all Traditional (pre-tax) across accounts.
  const priorYearEndTradBalance = balances.preTax;

  // Per-person Traditional balance for per-person RMD (from individual accounts)
  const priorYearEndTradByPerson = new Map<number, number>();
  if (ctx.rmdStartAgeByPerson.size > 0 && ctx.hasIndividualAccounts) {
    for (const ia of ctx.indAccts) {
      if (ia.ownerPersonId != null && isPreTaxType(ia.taxType)) {
        const prev = priorYearEndTradByPerson.get(ia.ownerPersonId) ?? 0;
        priorYearEndTradByPerson.set(
          ia.ownerPersonId,
          prev + ia.startingBalance,
        );
      }
    }
  }

  // Spending strategy cross-year state
  const spendingState = initialCrossYearState();

  // IRMAA 2-year lookback
  const magiHistory: number[] = [];

  // Individual account balances
  const indBal = new Map<string, number>();
  for (const ia of ctx.indAccts) indBal.set(ctx.indKey(ia), ia.startingBalance);

  const { specToAccount, accountsWithSpecs } =
    ctx.hasIndividualAccounts && contributionSpecs
      ? buildSpecToAccountMapping(
          contributionSpecs,
          ctx.indAccts,
          ctx.indKey,
          ctx.indParentCat,
        )
      : {
          specToAccount: new Map<string, string>(),
          accountsWithSpecs: new Set<string>(),
        };

  // Per-person salary tracking (when salaryByPerson is provided)
  const projectedSalaryByPerson = new Map<number, number>();
  if (ctx.hasPerPersonSalary) {
    for (const [pid, sal] of Object.entries(input.salaryByPerson!)) {
      projectedSalaryByPerson.set(Number(pid), sal);
    }
  }

  return {
    balances,
    acctBal,
    priorYearEndTradBalance,
    priorYearEndTradByPerson,
    projectedSalary: input.currentSalary,
    projectedExpenses: input.annualExpenses,
    projectedSalaryByPerson,
    indBal,
    specToAccount,
    accountsWithSpecs,
    contributionSpecs,
    activeEmployerMatchRateByCategory,
    activeBaseYearContributions,
    activeBaseYearEmployerMatch,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    spendingState,
    magiHistory,
    firstOverflowYear: null,
    firstOverflowAge: null,
    firstOverflowAmount: null,
    portfolioDepletionYear: null,
    portfolioDepletionAge: null,
    accountDepletions: [],
    depletionTracked: new Set<string>(),
    projectionByYear: [],
  };
}
