/**
 * Withdrawals in a year someone with a job isn't working: one person has
 * retired and the other works on, or a job ended before its holder's
 * retirement. In ordinary saving years the plan takes pay as covering the
 * budget, so spending never touches balances. With a paycheck gone that no
 * longer holds, so the shortfall comes out of the accounts:
 *
 *   budget − (pay − the year's own contributions − tax on the pay)
 *
 * The draw runs through the same routing, eligibility, Roth growth split,
 * penalty and tax pricing as a retirement year (one path, not a copy): the
 * money stays subject to each owner's age, and someone still working has no
 * Rule of 55 on their own plan. Tax on the draw is priced on top of the pay,
 * and paid from the draw.
 */
import type { DecumulationSlot } from "../types";
import { roundToCents, sumBy } from "../../utils/math";
import {
  growLtcgBrackets,
  growWithholdingBrackets,
  taxGrowthFactor,
  taxTableYears,
} from "./bracket-growth";
import { resolveDecumulationConfig } from "./override-resolution";
import { routeForMode } from "./withdrawal-routing";
import { deriveBasisRankingInputs } from "./withdrawal-cost-ranking";
import {
  computeTaxFromSlots,
  estimateEffectiveTaxRate,
} from "./tax-estimation";
import { clampBalances, deductWithdrawals } from "./balance-deduction";
import {
  clampIndividualBalances,
  depleteIndividualBasis,
  distributeWithdrawals,
} from "./individual-account-tracking";
import { followDraws, retirementBrokerageBasisRatio } from "./brokerage-basis";
import {
  computeNonRetirementExclusion,
  computeWithdrawalEligibility,
} from "@/lib/pure/withdrawal-eligibility";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/early-withdrawal-penalty";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "./projection-year-handlers/types";

export type GapYearDraw = {
  /** Spending the year's pay doesn't cover, after tax. */
  need: number;
  /** What came out of the accounts: the need plus the tax on it. */
  withdrawal: number;
  /** Tax and any penalty on the draw (not on the pay). */
  taxCost: number;
  /** The need no reachable money could fund. */
  unmetNeed: number;
  slots: DecumulationSlot[];
  warnings: string[];
};

/** Below this the year counts as funded: rounding, not a shortfall. Same
 *  floor as a retirement year's. */
export function gapShortfallFloor(need: number): number {
  return Math.max(50, need * 0.01);
}

export function runGapYearDraw(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  args: {
    year: number;
    /** The year's pay and budget, already scaled to the part of it left. */
    pay: number;
    budget: number;
    /** The employee's contributions, and the Traditional part of them. */
    employeeContributions: number;
    pretaxContributions: number;
  },
): GapYearDraw | null {
  const { input, hasIndividualAccounts, indAccts, indKey } = ctx;
  const { balances, acctBal, indBal, indBasis, brokBasis } = state;
  const { year, pay, budget, employeeContributions, pretaxContributions } =
    args;
  const { decumulationDefaults, filingStatus } = input;
  const taxRates = decumulationDefaults.distributionTaxRates;

  const tableYears = taxTableYears(taxRates);
  const taxBrackets = taxRates.taxBrackets
    ? growWithholdingBrackets(
        taxRates.taxBrackets,
        taxGrowthFactor(year, tableYears.brackets, ctx.inflationRate),
      )
    : undefined;
  const standardDeduction =
    taxRates.standardDeduction != null
      ? taxRates.standardDeduction *
        taxGrowthFactor(year, tableYears.standardDeduction, ctx.inflationRate)
      : undefined;
  const ltcgBrackets = growLtcgBrackets(
    taxRates.ltcgBrackets,
    taxGrowthFactor(year, tableYears.ltcg, ctx.inflationRate),
  );

  const wages = Math.max(0, pay - pretaxContributions);
  const wageTax =
    (taxBrackets && taxBrackets.length > 0
      ? wages *
        estimateEffectiveTaxRate(
          wages,
          taxBrackets,
          taxRates.taxMultiplier,
          standardDeduction,
        )
      : wages * taxRates.traditionalFallbackRate) +
    pay * (input.payrollTaxRate ?? 0);
  const need = roundToCents(
    Math.max(0, budget - (pay - employeeContributions - wageTax)),
  );
  if (need < gapShortfallFloor(need)) return null;

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    ctx.sortedDecOverrides,
  );
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({ year, indAccts, indBal, indKey, indBasis })
    : undefined;
  const nonRetirement = hasIndividualAccounts
    ? computeNonRetirementExclusion(indAccts, indBal, indKey)
    : undefined;
  const retirementBasisRatio = hasIndividualAccounts
    ? retirementBrokerageBasisRatio(indAccts, indKey, indBal, brokBasis)
    : undefined;
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
  });

  const route = (target: number) =>
    routeForMode(
      target,
      config,
      acctBal,
      {
        taxBrackets,
        rothBracketTarget:
          config.rothBracketTarget ?? taxRates.rothBracketTarget,
        conversionTarget: taxRates.rothConversionTarget,
        // Pay is ordinary income already in the year, under the draw.
        taxableSS: wages,
        filingStatus,
        ltcgBrackets,
        rothBasisAvailable,
        brokerageBasisRatio,
        conversionsEnabled: false,
        standardDeduction,
        discretionaryWithdrawalOrder: config.discretionaryWithdrawalOrder,
      },
      eligibility,
      nonRetirement,
    );
  // Each account's actual share of a routed draw, on the balances given:
  // needed to size the draw (on copies) and to take it.
  const shareOut = (
    slots: DecumulationSlot[],
    bal: typeof indBal,
    basis: typeof indBasis,
  ) => {
    if (!hasIndividualAccounts)
      return {
        byKey: new Map<string, number>(),
        warnings: [] as string[],
        rothGrowth: 0,
        penalty: 0,
      };
    const before = new Map(bal);
    const { decIndWithdrawal, warnings } = distributeWithdrawals(
      slots,
      indAccts,
      indKey,
      bal,
      eligibility,
    );
    const draws = depleteIndividualBasis({
      indAccts,
      indKey,
      indBasis: basis,
      preWithdrawalBal: before,
      withdrawals: decIndWithdrawal,
    });
    return {
      byKey: decIndWithdrawal,
      warnings,
      rothGrowth: splitRothWithdrawalForTax({
        accounts: indAccts.map((ia) => ({
          indKey: indKey(ia),
          ownerBirthYear: ia.ownerBirthYear,
        })),
        draws,
        year,
      }).taxableGrowth,
      penalty: eligibility
        ? computeEarlyWithdrawalPenalty({
            exposure: eligibility,
            withdrawnByKey: decIndWithdrawal,
          }).penaltyCost
        : 0,
    };
  };
  // The tax on the draw alone: its share of ordinary income at the year's
  // average rate, with the pay's share left out, like Social Security's.
  const price = (
    slots: DecumulationSlot[],
    rothTaxableGrowth: number,
    penaltyCost: number,
  ) => {
    const priced = computeTaxFromSlots({
      slots,
      taxableSS: wages,
      balances,
      taxRates: { ...taxRates, taxBrackets, standardDeduction, ltcgBrackets },
      filingStatus,
      rothTaxableGrowth,
      penaltyCost,
      brokerageBasisRatio,
    });
    return {
      priced,
      cost: roundToCents(priced.taxCost - priced.ssTaxCost + penaltyCost),
    };
  };

  // Tax on the draw is paid from the draw; a few passes settle it, as that
  // tax is small beside the need.
  let result = route(need);
  for (let pass = 0; pass < 3; pass++) {
    const trial = shareOut(
      result.slots,
      new Map(indBal),
      new Map([...indBasis].map(([k, v]) => [k, { ...v }])),
    );
    result = route(
      roundToCents(
        need + price(result.slots, trial.rothGrowth, trial.penalty).cost,
      ),
    );
  }
  const { slots, warnings } = result;

  const taken = followDraws(indAccts, indKey, indBal, brokBasis, () =>
    shareOut(slots, indBal, indBasis),
  );
  const { priced, cost } = price(slots, taken.rothGrowth, taken.penalty);

  deductWithdrawals({
    slots,
    balances,
    acctBal,
    brokerageBasisPortion: priced.brokerageBasisPortion,
  });
  clampBalances(balances, acctBal);
  if (hasIndividualAccounts) {
    followDraws(indAccts, indKey, indBal, brokBasis, () =>
      clampIndividualBalances(indAccts, indKey, indBal),
    );
  }
  const withdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  return {
    need,
    withdrawal,
    taxCost: cost,
    unmetNeed: roundToCents(Math.max(0, need - (withdrawal - cost))),
    slots,
    warnings: [...warnings, ...taken.warnings],
  };
}
