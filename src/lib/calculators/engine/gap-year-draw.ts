/**
 * Withdrawals in a year someone with a job isn't working: one person has
 * retired and the other works on, or a job ended before its holder's
 * retirement. In ordinary saving years the plan takes pay as covering the
 * budget, so spending never touches balances. With a paycheck gone that no
 * longer holds, so the shortfall comes out of the accounts:
 *
 *   spending − (pay + Social Security − contributions − tax on that income)
 *
 * Spending leaves out budget lines that are contributions (they're the
 * contributions, and a stopped person's are zeroed already).
 *
 * The draw runs through the same routing, eligibility, Roth growth split,
 * penalty and tax pricing as a retirement year (one path, not a copy): the
 * money stays subject to each owner's age, and someone still working has no
 * Rule of 55 on their own plan. The draw pays what it adds to the year's tax:
 * the tax on everything less the tax on the income alone.
 *
 * Not modelled yet: RMDs before the plan's withdrawal year; a year with one
 * due says so.
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
import { socialSecurityForYear } from "./social-security-income";
import {
  computeTaxableSS,
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
): GapYearDraw | null {
  const { input, hasIndividualAccounts, indAccts, indKey } = ctx;
  const { balances, acctBal, indBal, indBasis, brokBasis } = state;
  const { year, age, fraction, payByPerson, budget } = args;
  const { employeeContributions, pretaxContributions } = args;
  const pay = sumBy(payByPerson, (p) => p);
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

  const ssIncome = roundToCents(
    socialSecurityForYear(input, year, age, ctx.inflationRate).ssIncome *
      fraction,
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
      taxGrowthFactor(year, tableYears.standardDeduction, ctx.inflationRate);
  const payrollCost = payrollTax
    ? sumBy(
        payByPerson,
        (p) =>
          Math.min(p, wageBase! * fraction) * payrollTax.socialSecurityRate +
          p * payrollTax.medicareRate,
      )
    : 0;
  const spending = budget * (1 - (input.budgetContributionShare ?? 0));
  const need = roundToCents(
    Math.max(
      0,
      spending -
        (pay + ssIncome - employeeContributions - taxOnIncome - payrollCost),
    ),
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
    indBal: hasIndividualAccounts ? indBal : undefined,
    year,
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
    warnings: [
      ...warnings,
      ...taken.warnings,
      ...[...ctx.rmdStartAgeByPerson.values()]
        .filter((p) => year - p.birthYear >= p.startAge)
        .slice(0, 1)
        .map(
          () =>
            `${year}: a required minimum distribution falls due before withdrawals start; the plan doesn't take it until then.`,
        ),
    ],
  };
}
