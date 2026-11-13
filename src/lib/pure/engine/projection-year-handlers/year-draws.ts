/** The decumulation year's draw: routed, then followed to each account. */
import { cloneAccountBalances } from "../balance-utils";
import { followDraws } from "../brokerage-basis";
import { routeForMode } from "../withdrawal-routing";
import { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import { depleteIndividualBasis } from "../individual-accounts/ledger";
import { distributeWithdrawals } from "../individual-accounts/withdrawals";
import type { enforceYearRmd } from "./rmd-step";
import type { yearNeed } from "./year-need";
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The year's target withdrawal routed across accounts by the configured
 *  mode, through the dispatch the solver's estimate shares. */
export function routeYearDraw(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  need: ReturnType<typeof yearNeed>,
  rothDivergence: string | null,
) {
  const { hasIndividualAccounts, indAccounts, indKey } = ctx;
  const { filingStatus } = ctx.input;
  const { accountBalance, balances, indBasis, indBalance } = state;
  const { year, taxRates, config, eligibility, retirementBasisRatio } =
    thisYear;
  const { nonRetirement } = thisYear.setup;
  const { grownTaxBrackets, grownLtcgBrackets, grownStandardDeduction } =
    thisYear.tables;
  const { targetWithdrawal, taxEstimate } = need;
  // Routing reads the tracked per-account balances; a copy is kept as
  // the year's pre-withdrawal row.
  const accountBalances = accountBalance;
  const preWithdrawalAcctBal = cloneAccountBalances(accountBalance);

  // routeForMode is the one dispatch the solver's estimate shares, so a
  // mode's rule can't differ between them; its basis-ranking inputs come from
  // deriveBasisRankingInputs (bracket filling only), as in the estimate.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccounts: hasIndividualAccounts ? indAccounts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBalance: hasIndividualAccounts ? indBalance : undefined,
    year,
  });

  // The conversion's target, resolved once: the routing reservation and the
  // conversion that runs later must target the same rate
  // (roth-conversion-target-priority.test.ts).
  const resolvedConversionTarget =
    taxRates.rothConversionTarget ??
    config.rothBracketTarget ??
    taxRates.rothBracketTarget;
  const routeResult = routeForMode(
    targetWithdrawal,
    config,
    accountBalances,
    {
      taxBrackets: grownTaxBrackets,
      // The year's override, else the plan's default: a rate, so not grown.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      // The rate the conversion targets, when it differs (only with
      // conversions on).
      conversionTarget: resolvedConversionTarget,
      taxableSS: taxEstimate.taxableSS,
      filingStatus,
      ltcgBrackets: grownLtcgBrackets,
      rothBasisAvailable,
      brokerageBasisRatio,
      conversionsEnabled: taxRates.enableRothConversions,
      standardDeduction: grownStandardDeduction,
      discretionaryWithdrawalOrder: config.discretionaryWithdrawalOrder,
    },
    eligibility,
    nonRetirement,
  );

  const {
    slots,
    warnings: routeWarnings,
    unmetNeed: routedUnmetNeed,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
  } = routeResult;
  if (rothDivergence) routeWarnings.push(rothDivergence);

  return {
    preWithdrawalAcctBal,
    brokerageBasisRatio,
    resolvedConversionTarget,
    routeResult,
    slots,
    routeWarnings,
    routedUnmetNeed,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
  };
}

/** The routed draw followed to each account (RMD pins kept), its Roth basis
 *  drawn, the Roth growth's taxable share, and any early-withdrawal penalty. */
export function distributeYearDraws(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: {
    route: ReturnType<typeof routeYearDraw>;
    rmd: ReturnType<typeof enforceYearRmd>;
  },
) {
  const { hasIndividualAccounts, indAccounts, indKey } = ctx;
  const { year, eligibility } = thisYear;
  const { slots, routeWarnings } = flow.route;
  const { ownerRmd } = flow.rmd;
  // Copies: drawn before tax, landed by settleYearDraws with the deduction.
  const indBalance = new Map(state.indBalance);
  const brokBasis = new Map(state.brokBasis);
  const indBasis = new Map(state.indBasis);
  const distributeResult = hasIndividualAccounts
    ? followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
        distributeWithdrawals(
          slots,
          indAccounts,
          indKey,
          indBalance,
          eligibility,
          ownerRmd?.pins,
        ),
      )
    : { decumulationIndWithdrawal: new Map<string, number>(), warnings: [] };
  const decumulationIndWithdrawal = distributeResult.decumulationIndWithdrawal;
  routeWarnings.push(...distributeResult.warnings);
  const basisDraws = hasIndividualAccounts
    ? depleteIndividualBasis({
        indAccounts,
        indKey,
        indBasis,
        preWithdrawalBalance: state.indBalance,
        withdrawals: decumulationIndWithdrawal,
      })
    : new Map<string, BasisDraw>();

  // The Roth growth's taxable share from this year's basis draws (owner
  // under 59 1/2; a joint account counts as qualified).
  const rothTaxSplit = hasIndividualAccounts
    ? splitRothWithdrawalForTax({
        accounts: indAccounts.map((ia) => ({
          indKey: indKey(ia),
          ownerBirthYear: ia.ownerBirthYear,
        })),
        draws: basisDraws,
        year,
      })
    : { taxableGrowth: 0, taxFreeAmount: 0, byKey: new Map() };

  // The penalty on what was actually drawn: 0 when routing kept penalized
  // money out (the default), priced whatever the reason otherwise.
  const earlyWithdrawalPenalty =
    hasIndividualAccounts && eligibility
      ? computeEarlyWithdrawalPenalty({
          exposure: eligibility,
          withdrawnByKey: decumulationIndWithdrawal,
        })
      : { penaltyCost: 0, penalizedAmount: 0, byKey: new Map() };

  return {
    decumulationIndWithdrawal,
    basisDraws,
    rothTaxSplit,
    earlyWithdrawalPenalty,
    ledger: { indBalance, brokBasis, indBasis },
  };
}
