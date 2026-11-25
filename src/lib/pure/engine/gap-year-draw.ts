/**
 * Withdrawals in a year a job-holder isn't working: spending − (pay + SS − contributions − tax),
 * through the retirement year's routing, eligibility, penalty and tax pricing. RMDs before the
 * plan's withdrawal year are not modelled; a year with one due says so.
 */
import type { DecumulationSlot } from "./types/routing";
import type { GapYearDraw } from "./types/gap-year-draw";
import type { GapYearNeed } from "./gap-year-need";
import { roundToCents, sumBy } from "../../utils/math";
import { SHORTFALL_MATERIALITY } from "../../constants";
import { resolveDecumulationConfig } from "./override-resolution";
import { routeForMode } from "./withdrawal-routing";
import { deriveBasisRankingInputs } from "./withdrawal-cost-ranking";
import { computeTaxFromSlots } from "./tax-estimation";
import { clampBalances, deductWithdrawals } from "./balance-deduction";
import { floorPartsAndSlices } from "./category-slices";
import { depleteIndividualBasis } from "./individual-accounts/ledger";
import { distributeWithdrawals } from "./individual-accounts/withdrawals";
import { followDraws, retirementBrokerageBasisRatio } from "./brokerage-basis";
import {
  computeNonRetirementExclusion,
  computeWithdrawalEligibility,
} from "@/lib/pure/accounts/eligibility";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "./projection-year-handlers/types";
import type { IncomeBesideWages } from "@/lib/pure/tax/year-income";
import { drawNiit } from "@/lib/pure/tax/niit";

/** Each account's part of the draw, for the year's account rows. Not on
 *  the year row itself (Maps don't serialize). */
export type GapYearAccounts = {
  withdrawal: Map<string, number>;
  draws: Map<string, BasisDraw>;
  eligibility: EligibilityRecord | undefined;
};

/** A gap year's draw, its accounts, and its income beside wages (the draw's
 *  streams and the year's Social Security) as its IRMAA tax year reads it. */
export type GapYearRun = {
  draw: GapYearDraw;
  accounts: GapYearAccounts | null;
  income: IncomeBesideWages;
};

/** Below this a gap or retirement year counts as funded: rounding, not a
 *  shortfall (SHORTFALL_MATERIALITY). */
export function shortfallFloor(need: number): number {
  const { minimum, shareOfNeed } = SHORTFALL_MATERIALITY;
  return Math.max(minimum, need * shareOfNeed);
}

/** Whether a gap year's unmet need is a shortfall: at or over its floor.
 *  A retirement year's test is `unmetNeedMaterial`. */
export function gapUnmetNeedMaterial(
  gap: Pick<GapYearDraw, "need" | "unmetNeed">,
): boolean {
  return gap.unmetNeed >= shortfallFloor(gap.need);
}

export function runGapYearDraw(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  sized: GapYearNeed,
): GapYearRun {
  const { input, holdsAccounts, indAccounts, indKey } = ctx;
  const { balances, accountBalance, indBalance, indBasis, brokBasis } = state;
  const { year, need, figures, wages, incomeAlone, taxOnIncome } = sized;
  const { taxableSsOn, taxBrackets, standardDeduction, ltcgBrackets } = sized;
  const { decumulationDefaults, filingStatus } = input;
  const taxRates = decumulationDefaults.distributionTaxRates;
  const noDraw = {
    need,
    withdrawal: 0,
    taxCost: 0,
    unmetNeed: 0,
    spendingCut: 0,
    ...figures,
    slots: [],
    warnings: [],
  };
  const undrawn = { accounts: null, income: besideWages(sized) };
  if (need < shortfallFloor(need))
    return { draw: { ...noDraw, need: 0 }, ...undrawn };
  if (input.gapYearDraws === false)
    return { draw: { ...noDraw, spendingCut: need }, ...undrawn };

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    ctx.sortedDecumulationOverrides,
  );
  const eligibility = ctx.holdsAccounts
    ? computeWithdrawalEligibility({
        year,
        indAccounts,
        indBalance,
        indKey,
        indBasis,
      })
    : undefined;
  const nonRetirement = holdsAccounts
    ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
    : undefined;
  const retirementBasisRatio = holdsAccounts
    ? retirementBrokerageBasisRatio(indAccounts, indKey, indBalance, brokBasis)
    : undefined;
  const rankingInputs = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: holdsAccounts ? indBasis : undefined,
    indAccounts: holdsAccounts ? indAccounts : undefined,
    indKey: holdsAccounts ? indKey : undefined,
    indBalance: holdsAccounts ? indBalance : undefined,
    year,
  });

  const route = (target: number) =>
    routeForMode(
      target,
      config,
      accountBalance,
      {
        taxBrackets,
        rothBracketTarget:
          config.rothBracketTarget ?? taxRates.rothBracketTarget,
        conversionTarget: taxRates.rothConversionTarget,
        // Income already in the year, under the draw.
        taxableSS: incomeAlone,
        ssIncome: { gross: figures.ssIncome, otherIncome: wages },
        filingStatus,
        ltcgBrackets,
        ...rankingInputs,
        conversionsEnabled: false,
        standardDeduction,
        discretionaryWithdrawalOrder: config.discretionaryWithdrawalOrder,
        taxMultiplier: taxRates.taxMultiplier,
      },
      eligibility,
      nonRetirement,
    );
  // Each account's share of a routed draw: sizes the draw (on copies), takes it.
  const shareOut = (
    slots: DecumulationSlot[],
    balance: typeof indBalance,
    basis: typeof indBasis,
  ) => {
    if (!holdsAccounts)
      return {
        byKey: new Map<string, number>(),
        draws: new Map<string, BasisDraw>(),
        warnings: [] as string[],
        rothGrowth: 0,
        penalty: 0,
      };
    const before = new Map(balance);
    const { decumulationIndWithdrawal, warnings } = distributeWithdrawals(
      slots,
      indAccounts,
      indKey,
      balance,
      eligibility,
    );
    const draws = depleteIndividualBasis({
      indAccounts,
      indKey,
      indBasis: basis,
      preWithdrawalBalance: before,
      withdrawals: decumulationIndWithdrawal,
    });
    return {
      byKey: decumulationIndWithdrawal,
      draws,
      warnings,
      rothGrowth: splitRothWithdrawalForTax({
        accounts: indAccounts.map((ia) => ({
          indKey: indKey(ia),
          ownerBirthYear: ia.ownerBirthYear,
        })),
        draws,
        year,
      }).taxableGrowth,
      penalty: eligibility
        ? computeEarlyWithdrawalPenalty({
            exposure: eligibility,
            withdrawnByKey: decumulationIndWithdrawal,
          }).penaltyCost
        : 0,
    };
  };
  // The draw's added tax (and penalty), with the Social Security it makes taxable.
  const price = (
    slots: DecumulationSlot[],
    rothTaxableGrowth: number,
    penaltyCost: number,
  ) => {
    const pricedWith = (otherIncome: number) =>
      computeTaxFromSlots({
        slots,
        taxableSS: otherIncome,
        balances,
        taxRates: { ...taxRates, taxBrackets, standardDeduction, ltcgBrackets },
        filingStatus,
        rothTaxableGrowth,
        penaltyCost,
        brokerageBasisRatio: retirementBasisRatio,
      });
    const first = pricedWith(incomeAlone);
    const drawIncome =
      first.actualTaxableIncome - incomeAlone + first.brokerageGainsPortion;
    const taxableSS = taxableSsOn(wages + drawIncome);
    const priced = pricedWith(wages + taxableSS);
    // The NIIT's MAGI counts the wages beside the draw (IRC § 1411(d)).
    const niit = drawNiit(priced, wages + taxableSS, filingStatus);
    const added =
      Math.max(0, priced.taxCost - taxOnIncome) + penaltyCost + niit;
    return { priced, taxableSS, cost: roundToCents(added) };
  };

  // The draw pays its own tax; a few passes settle it (small beside the need).
  let result = route(need);
  for (let pass = 0; pass < 3; pass++) {
    const trial = shareOut(
      result.slots,
      new Map(indBalance),
      new Map([...indBasis].map(([k, v]) => [k, { ...v }])),
    );
    result = route(
      roundToCents(
        need + price(result.slots, trial.rothGrowth, trial.penalty).cost,
      ),
    );
  }
  const { slots, warnings } = result;

  const taken = followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
    shareOut(slots, indBalance, indBasis),
  );
  const settled = price(slots, taken.rothGrowth, taken.penalty);
  const { priced, cost } = settled;

  deductWithdrawals({
    slots,
    balances,
    accountBalance,
    basisOut: priced.brokerageBasisOut,
  });
  const floorRaised = clampBalances(balances, accountBalance);
  if (holdsAccounts) floorPartsAndSlices(ctx, state, floorRaised);
  const withdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  const accounts: GapYearAccounts = {
    withdrawal: taken.byKey,
    draws: taken.draws,
    eligibility,
  };
  const draw: GapYearDraw = {
    need,
    withdrawal,
    taxCost: cost,
    unmetNeed: roundToCents(Math.max(0, need - (withdrawal - cost))),
    spendingCut: 0,
    ...figures,
    slots,
    warnings: [
      ...warnings,
      ...taken.warnings,
      ...[...ctx.rmdStartAgeByPerson.values()]
        .filter((p) => year - p.birthYear >= p.startAge)
        .slice(0, 1)
        .map(
          () =>
            `${year}: a required minimum distribution falls due before withdrawals start; the projection doesn't take it until then.`,
        ),
    ],
  };
  return { draw, accounts, income: besideWages(sized, settled) };
}

/** The year's income beside wages: the draw's Traditional draws, taxable
 *  Roth growth and gains, as its tax is priced, and its Social Security. */
function besideWages(
  sized: GapYearNeed,
  drawn?: {
    priced: ReturnType<typeof computeTaxFromSlots>;
    taxableSS: number;
  },
): IncomeBesideWages {
  const gross = sized.figures.ssIncome;
  if (!drawn)
    return {
      traditionalDraws: 0,
      rothTaxableGrowth: 0,
      realizedGains: 0,
      socialSecurity: { gross, taxable: sized.taxableSsOn(sized.wages) },
    };
  const { priced, taxableSS } = drawn;
  return {
    traditionalDraws: priced.totalTraditionalWithdrawal,
    rothTaxableGrowth: priced.rothTaxableGrowth,
    realizedGains: priced.brokerageGainsPortion,
    socialSecurity: { gross, taxable: taxableSS },
  };
}
