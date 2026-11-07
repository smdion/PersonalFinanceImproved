/** The decumulation year's draw: routed, then followed to each account. */
import { cloneAccountBalances } from "../balance-utils";
import { followDraws } from "../brokerage-basis";
import { routeForMode } from "../withdrawal-routing";
import { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import {
  depleteIndividualBasis,
  distributeWithdrawals,
} from "../individual-account-tracking";
import type { computeWithdrawalEligibility } from "@/lib/pure/accounts/eligibility";
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import type {
  growLtcgBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import type { resolveDecumulationConfig } from "../override-resolution";
import type { enforceYearRmd } from "./rmd-step";
import type { yearNeed } from "./year-need";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The year's target withdrawal routed across accounts by the configured
 *  mode, through the dispatch the solver's estimate shares. */
export function routeYearDraw(
  acctBal: ProjectionLoopState["acctBal"],
  balances: ProjectionLoopState["balances"],
  retirementBasisRatio: number | undefined,
  hasIndividualAccounts: boolean,
  indBasis: ProjectionLoopState["indBasis"],
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
  year: number,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  config: ReturnType<typeof resolveDecumulationConfig>,
  targetWithdrawal: number,
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined,
  taxEst: ReturnType<typeof yearNeed>["taxEst"],
  filingStatus: ProjectionContext["input"]["filingStatus"],
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  grownStandardDeduction: number | undefined,
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined,
  nonRetirement: PreYearSetup["nonRetirement"],
  rothDivergence: string | null,
) {
  // Routing reads the tracked per-account balances; a copy is kept as
  // the year's pre-withdrawal row.
  const acctBalances = acctBal;
  const preWithdrawalAcctBal = cloneAccountBalances(acctBal);

  // routeForMode is the one dispatch the solver's estimate shares, so a
  // mode's rule can't differ between them; its basis-ranking inputs come from
  // deriveBasisRankingInputs (bracket filling only), as in the estimate.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBal: hasIndividualAccounts ? indBal : undefined,
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
    acctBalances,
    {
      taxBrackets: grownTaxBrackets,
      // The year's override, else the plan's default: a rate, so not grown.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      // The rate the conversion targets, when it differs (only with
      // conversions on).
      conversionTarget: resolvedConversionTarget,
      taxableSS: taxEst.taxableSS,
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
  indBal: ProjectionLoopState["indBal"],
  hasIndividualAccounts: boolean,
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  brokBasis: ProjectionLoopState["brokBasis"],
  slots: ReturnType<typeof routeForMode>["slots"],
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined,
  ownerRmd: ReturnType<typeof enforceYearRmd>["ownerRmd"],
  routeWarnings: string[],
  indBasis: ProjectionLoopState["indBasis"],
  year: number,
) {
  // Draws reach accounts before tax: the tax reads this year's Roth basis
  // draws, and only indBal/indBasis change here. indBal is copied first for
  // the basis draw's pro-rata ratio.
  const preWithdrawalIndBal = new Map(indBal);
  const distributeResult = hasIndividualAccounts
    ? followDraws(indAccts, indKey, indBal, brokBasis, () =>
        distributeWithdrawals(
          slots,
          indAccts,
          indKey,
          indBal,
          eligibility,
          ownerRmd?.pins,
        ),
      )
    : { decIndWithdrawal: new Map<string, number>(), warnings: [] };
  const decIndWithdrawal = distributeResult.decIndWithdrawal;
  routeWarnings.push(...distributeResult.warnings);
  const basisDraws = hasIndividualAccounts
    ? depleteIndividualBasis({
        indAccts,
        indKey,
        indBasis,
        preWithdrawalBal: preWithdrawalIndBal,
        withdrawals: decIndWithdrawal,
      })
    : new Map<string, BasisDraw>();

  // The Roth growth's taxable share from this year's basis draws (owner
  // under 59 1/2; a joint account counts as qualified).
  const rothTaxSplit = hasIndividualAccounts
    ? splitRothWithdrawalForTax({
        accounts: indAccts.map((ia) => ({
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
          withdrawnByKey: decIndWithdrawal,
        })
      : { penaltyCost: 0, penalizedAmount: 0, byKey: new Map() };

  return { decIndWithdrawal, basisDraws, rothTaxSplit, earlyWithdrawalPenalty };
}
