/**
 * Withdrawals in a year a job-holder isn't working: spending − (pay + SS − contributions − tax),
 * through the retirement year's routing, eligibility, penalty and tax pricing. RMDs before the
 * plan's withdrawal year are not modelled; a year with one due says so.
 */
import type { DecumulationSlot } from "./types/routing";
import type { GapYearDraw } from "./types/gap-year-draw";
import { roundToCents, sumBy } from "../../utils/math";
import { SHORTFALL_MATERIALITY } from "../../constants";
import {
  growLtcgBrackets,
  growWithholdingBrackets,
  taxTableYears,
} from "./bracket-growth";
import { resolveDecumulationConfig } from "./override-resolution";
import { routeForMode } from "./withdrawal-routing";
import { deriveBasisRankingInputs } from "./withdrawal-cost-ranking";
import { socialSecurityForYear } from "./social-security-income";
import {
  computeTaxableSS,
  computeTaxFromSlots,
  estimateEffectiveTaxRate,
} from "./tax-estimation";
import { clampBalances, deductWithdrawals } from "./balance-deduction";
import { clampIndividualBalances } from "./individual-accounts/reconcile";
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

/** Each account's part of the draw, for the year's account rows. Not on
 *  the year row itself (Maps don't serialize). */
export type GapYearAccounts = {
  withdrawal: Map<string, number>;
  draws: Map<string, BasisDraw>;
  eligibility: EligibilityRecord | undefined;
};

/** Below this a gap or retirement year counts as funded: rounding, not a
 *  shortfall (SHORTFALL_MATERIALITY). */
export function shortfallFloor(need: number): number {
  const { minimum, shareOfNeed } = SHORTFALL_MATERIALITY;
  return Math.max(minimum, need * shareOfNeed);
}

export function runGapYearDraw(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  args: {
    year: number;
    age: number;
    /** The part of the year the plan covers (year 0 is partial). */
    fraction: number;
    /** The year's pay, per person, and budget: scaled to `fraction`. */
    payByPerson: readonly number[];
    budget: number;
    /** The employee's contributions, and the Traditional part of them. */
    employeeContributions: number;
    pretaxContributions: number;
  },
): { draw: GapYearDraw; accounts: GapYearAccounts | null } {
  const { input, hasIndividualAccounts, indAccounts, indKey } = ctx;
  const { balances, accountBalance, indBalance, indBasis, brokBasis } = state;
  const { year, age, fraction, payByPerson, budget } = args;
  const { employeeContributions, pretaxContributions } = args;
  const pay = sumBy(payByPerson, (p) => p);
  const { decumulationDefaults, filingStatus } = input;
  const taxRates = decumulationDefaults.distributionTaxRates;

  const tableYears = taxTableYears(taxRates);
  const taxBrackets = taxRates.taxBrackets
    ? growWithholdingBrackets(
        taxRates.taxBrackets,
        ctx.inflation.growthSinceVintage(year, tableYears.brackets),
      )
    : undefined;
  const standardDeduction =
    taxRates.standardDeduction != null
      ? taxRates.standardDeduction *
        ctx.inflation.growthSinceVintage(year, tableYears.standardDeduction)
      : undefined;
  const ltcgBrackets = growLtcgBrackets(
    taxRates.ltcgBrackets,
    ctx.inflation.growthSinceVintage(year, tableYears.ltcg),
  );

  const ssIncome = roundToCents(
    socialSecurityForYear(
      input,
      year,
      age,
      ctx.inflation.growth(year - input.asOfDate.getFullYear()),
    ).ssIncome * fraction,
  );
  const wages = Math.max(0, pay - pretaxContributions);
  const taxableSsOn = (otherIncome: number) =>
    filingStatus ? computeTaxableSS(ssIncome, otherIncome, filingStatus) : 0;
  const incomeTaxOn = (income: number) =>
    income *
    (taxBrackets && taxBrackets.length > 0
      ? estimateEffectiveTaxRate(
          income,
          taxBrackets,
          taxRates.taxMultiplier,
          standardDeduction,
        )
      : taxRates.traditionalFallbackRate);
  const incomeAlone = wages + taxableSsOn(wages);
  const taxOnIncome = incomeTaxOn(incomeAlone);
  const { payrollTax } = input;
  const wageBase =
    payrollTax &&
    payrollTax.socialSecurityWageBase *
      ctx.inflation.growthSinceVintage(year, tableYears.standardDeduction);
  const payrollCost = payrollTax
    ? sumBy(
        payByPerson,
        (p) =>
          Math.min(p, wageBase! * fraction) * payrollTax.socialSecurityRate +
          p * payrollTax.medicareRate,
      )
    : 0;
  // Contribution lines inflate with the budget and aren't in a typed figure.
  const typedFigure = [...ctx.budgetOverrideMap.keys()].some((y) => y <= year);
  const contributionLines = typedFigure
    ? 0
    : input.budgetContributionLines *
      ctx.inflation.growth(year - input.asOfDate.getFullYear()) *
      fraction;
  const spending = Math.max(0, budget - contributionLines);
  const need = roundToCents(
    Math.max(
      0,
      spending -
        (pay + ssIncome - employeeContributions - taxOnIncome - payrollCost),
    ),
  );
  const figures = {
    pay,
    ssIncome,
    contributions: employeeContributions,
    taxOnIncome: roundToCents(taxOnIncome + payrollCost),
    spending: roundToCents(spending),
  };
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
  if (need < shortfallFloor(need))
    return { draw: { ...noDraw, need: 0 }, accounts: null };
  if (input.gapYearDraws === false)
    return { draw: { ...noDraw, spendingCut: need }, accounts: null };

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    ctx.sortedDecumulationOverrides,
  );
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({
        year,
        indAccounts,
        indBalance,
        indKey,
        indBasis,
      })
    : undefined;
  const nonRetirement = hasIndividualAccounts
    ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
    : undefined;
  const retirementBasisRatio = hasIndividualAccounts
    ? retirementBrokerageBasisRatio(indAccounts, indKey, indBalance, brokBasis)
    : undefined;
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccounts: hasIndividualAccounts ? indAccounts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBalance: hasIndividualAccounts ? indBalance : undefined,
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
    balance: typeof indBalance,
    basis: typeof indBasis,
  ) => {
    if (!hasIndividualAccounts)
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
  // What the draw adds to the year's tax (and any penalty). The draw can
  // make more Social Security taxable, so that's settled first.
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
        brokerageBasisRatio,
      });
    const first = pricedWith(incomeAlone);
    const drawIncome =
      first.actualTaxableIncome - incomeAlone + first.brokerageGainsPortion;
    const priced = pricedWith(wages + taxableSsOn(wages + drawIncome));
    return {
      priced,
      cost: roundToCents(
        Math.max(0, priced.taxCost - taxOnIncome) + penaltyCost,
      ),
    };
  };

  // Tax on the draw is paid from the draw; a few passes settle it, as that
  // tax is small beside the need.
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
  const { priced, cost } = price(slots, taken.rothGrowth, taken.penalty);

  deductWithdrawals({
    slots,
    balances,
    accountBalance,
    brokerageBasisPortion: priced.brokerageBasisPortion,
  });
  clampBalances(balances, accountBalance);
  if (hasIndividualAccounts) {
    followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
      clampIndividualBalances(indAccounts, indKey, indBalance),
    );
  }
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
  return { draw, accounts };
}
