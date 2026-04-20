/**
 * runDecumulationYear — single-year decumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 refactor. Pure relocation — no logic changes, behavior byte-identical.
 */
import type {
  DecumulationSlot,
  EngineDecumulationYear,
  IndividualAccountYearBalance,
} from "../../types";
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  getDefaultDecumulationOrder,
  isOverflowTarget,
  isPortfolioParent,
} from "../../../config/account-types";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { cloneAccountBalances } from "../balance-utils";
import { getLtcgRate, computeLtcgTax } from "../../../config/tax-tables";
import { computeNiit } from "../../../config/niit";
import { resolveDecumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  computeTaxableSS,
  estimateWithdrawalTaxCost,
} from "../tax-estimation";
import {
  routeWithdrawals,
  routeWithdrawalsPercentage,
  routeWithdrawalsBracketFilling,
} from "../withdrawal-routing";
import { enforceRmd } from "../rmd-enforcement";
import {
  performRothConversion,
  checkIrmaa,
  checkAca,
} from "../post-withdrawal-optimizer";
import { MEDICARE_START_AGE } from "@/lib/config/irmaa-tables";
import {
  distributeWithdrawals,
  applyIndividualGrowth,
  buildIndividualYearBalances,
  clampIndividualBalances,
} from "../individual-account-tracking";
import {
  deductWithdrawals,
  clampBalances,
  reinvestRmdExcess,
  trackDepletions,
  cleanupDust,
} from "../balance-deduction";
import { getRmdFactor } from "../../../config/rmd-tables";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { updatePerPersonTradBalance } from "./helpers";
import { applyLumpSums } from "./lump-sum";

// ---------------------------------------------------------------------------
// Decumulation year handler
// ---------------------------------------------------------------------------

/**
 * Run a single decumulation year. Mutates state in place and pushes
 * the year projection to state.projectionByYear.
 *
 * Logic copied exactly from projection.ts lines 1079-1539.
 */
export function runDecumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  y: number,
  setup: PreYearSetup,
): void {
  const { age, year, returnRate, strategyAction, totalBalance } = setup;
  const {
    input,
    budgetOverrideMap,
    sortedDecOverrides,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    rmdStartAge,
    rmdStartAgeByPerson,
  } = ctx;
  const {
    balances,
    acctBal,
    priorYearEndTradBalance,
    priorYearEndTradByPerson,
    indBal,
    spendingState,
    magiHistory,
    depletionTracked,
    accountDepletions,
  } = state;

  const {
    decumulationDefaults,
    socialSecurityAnnual,
    ssStartAge,
    filingStatus,
    enableIrmaaAwareness,
    enableAcaAwareness,
    householdSize,
    perPersonBirthYears,
  } = input;

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    sortedDecOverrides,
  );

  // Reconciliation check: acctBal Roth total should match balances.taxFree
  const acctBalRothTotal = getAllCategories().reduce((s, cat) => {
    const b = acctBal[cat];
    return s + (b.structure === "roth_traditional" ? b.roth : 0);
  }, 0);
  const rothDivergence =
    Math.abs(acctBalRothTotal - balances.taxFree) > 1
      ? `[DIAG] Roth divergence: acctBal.roth=${acctBalRothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - acctBalRothTotal).toFixed(0)}`
      : null;

  // Social Security income reduces withdrawal need
  // Per-person SS: each person's SS kicks in at their own age
  let ssIncome: number;
  let ssIncomeByPerson:
    | { personId: number; personName: string; amount: number }[]
    | undefined;
  if (input.socialSecurityEntries && input.socialSecurityEntries.length > 0) {
    ssIncomeByPerson = input.socialSecurityEntries.map((entry) => {
      const personAge = year - entry.birthYear;
      return {
        personId: entry.personId,
        personName: entry.personName,
        amount: personAge >= entry.startAge ? entry.annualAmount : 0,
      };
    });
    ssIncome = ssIncomeByPerson.reduce((sum, e) => sum + e.amount, 0);
  } else {
    ssIncome = age >= ssStartAge ? socialSecurityAnnual : 0;
  }
  const afterTaxNeed = roundToCents(
    Math.max(0, state.projectedExpenses - ssIncome),
  );

  // Tax gross-up: estimate tax from expected withdrawal routing, then
  // increase withdrawal so after-tax proceeds cover the expense need.
  const taxRates = decumulationDefaults.distributionTaxRates;
  const estTraditionalPortion =
    totalBalance > 0 ? balances.preTax / totalBalance : 0;

  // SS convergence + gross-up estimation (extracted to tax-estimation module)
  const taxEst = estimateWithdrawalTaxCost({
    afterTaxNeed,
    ssIncome,
    filingStatus,
    config,
    taxRates,
    balances,
    acctBal,
    totalBalance,
    estTraditionalPortion,
  });
  let { taxableSS } = taxEst;
  let { grossUpFactor } = taxEst;
  const { targetWithdrawal } = taxEst;

  // Build per-account, per-tax-type balances for withdrawal routing
  // Uses real per-account balances tracked through accumulation
  const acctBalances = acctBal;
  const preWithdrawalAcctBal = cloneAccountBalances(acctBal);

  // Route withdrawals based on configured mode.
  // bracket_filling: tax-optimal -- fills traditional up to bracket cap, Roth for rest
  // waterfall: sequential drain in priority order (legacy behavior)
  // percentage: fixed % split across accounts
  //
  // For waterfall/percentage, Roth bracket optimization can still overlay
  // via rothBracketTarget (sets a traditional tax-type cap).
  let routeResult: {
    slots: DecumulationSlot[];
    warnings: string[];
    traditionalCap?: number;
    unmetNeed?: number;
  };

  if (config.withdrawalRoutingMode === "bracket_filling") {
    routeResult = routeWithdrawalsBracketFilling(
      targetWithdrawal,
      config,
      acctBalances,
      {
        taxBrackets: taxRates.taxBrackets,
        rothBracketTarget: taxRates.rothBracketTarget,
        taxableSS,
      },
    );
  } else if (config.withdrawalRoutingMode === "percentage") {
    routeResult = routeWithdrawalsPercentage(
      targetWithdrawal,
      config,
      acctBalances,
    );
  } else {
    // Waterfall mode -- apply Roth bracket optimization overlay if configured
    const routeConfig = { ...config };
    if (
      taxRates.rothBracketTarget != null &&
      taxRates.taxBrackets &&
      taxRates.taxBrackets.length > 0
    ) {
      const incomeCap = incomeCapForMarginalRate(
        taxRates.rothBracketTarget,
        taxRates.taxBrackets,
      );
      const rothOptTraditionalCap = roundToCents(
        Math.max(0, incomeCap - taxableSS),
      );
      if (rothOptTraditionalCap < Infinity) {
        const existingTradCap = routeConfig.withdrawalTaxTypeCaps.traditional;
        routeConfig.withdrawalTaxTypeCaps = {
          ...routeConfig.withdrawalTaxTypeCaps,
          traditional:
            existingTradCap !== null
              ? Math.min(rothOptTraditionalCap, existingTradCap)
              : rothOptTraditionalCap,
        };
        // Set Roth-split categories to traditional preference for bracket optimization,
        // but only where the user hasn't set an explicit preference (null = no preference).
        const tradOverrides = Object.fromEntries(
          categoriesWithTaxPreference()
            .filter((cat) => routeConfig.withdrawalTaxPreference[cat] === null)
            .map((cat) => [cat, "traditional" as const]),
        );
        routeConfig.withdrawalTaxPreference = {
          ...routeConfig.withdrawalTaxPreference,
          ...tradOverrides,
        };
        routeConfig.withdrawalOrder = getDefaultDecumulationOrder();
      }
    }
    routeResult = routeWithdrawals(targetWithdrawal, routeConfig, acctBalances);
  }

  const { slots, warnings: routeWarnings } = routeResult;
  if (rothDivergence) routeWarnings.push(rothDivergence);

  let totalWithdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  const totalRothWithdrawal = roundToCents(
    sumBy(slots, (s) => s.rothWithdrawal),
  );
  let totalTraditionalWithdrawal = roundToCents(
    sumBy(slots, (s) => s.traditionalWithdrawal),
  );

  // --- RMD enforcement (Phase 1) ---
  // Per-person RMD: compute each person's RMD from their own Traditional balance and age.
  let perPersonRmdTotal: number | undefined;
  let rmdByPerson:
    | { personId: number; personName: string; amount: number }[]
    | undefined;
  if (rmdStartAgeByPerson.size > 0 && priorYearEndTradByPerson.size > 0) {
    rmdByPerson = [];
    let total = 0;
    for (const [personId, { startAge, birthYear }] of rmdStartAgeByPerson) {
      const personAge = year - birthYear;
      const personTrad = priorYearEndTradByPerson.get(personId) ?? 0;
      if (personAge >= startAge && personTrad > 0) {
        const factor = getRmdFactor(personAge);
        if (factor != null && factor > 0) {
          const amt = roundToCents(personTrad / factor);
          rmdByPerson.push({
            personId,
            personName:
              input.socialSecurityEntries?.find((e) => e.personId === personId)
                ?.personName ?? `Person ${personId}`,
            amount: amt,
          });
          total += amt;
        }
      }
    }
    if (total > 0) perPersonRmdTotal = roundToCents(total);
  }

  // Extracted to rmd-enforcement.ts -- enforces minimum Traditional withdrawals per IRS rules.
  const rmdResult = enforceRmd({
    age,
    rmdStartAge,
    priorYearEndTradBalance,
    slots,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    acctBal,
    overrideRmdRequired: perPersonRmdTotal,
  });
  const { rmdAmount, rmdOverrodeRouting } = rmdResult;
  totalTraditionalWithdrawal = rmdResult.totalTraditionalWithdrawal;
  totalWithdrawal = rmdResult.totalWithdrawal;
  routeWarnings.push(...rmdResult.warnings);

  // Recompute taxableSS with actual Traditional withdrawal (post-RMD) for final tax cost.
  // TODO(F2): If muni bond income tracking is added, pass taxExemptInterest as 4th arg.
  if (filingStatus && ssIncome > 0) {
    taxableSS = computeTaxableSS(
      ssIncome,
      totalTraditionalWithdrawal,
      filingStatus,
    );
  }

  // Calculate tax cost per withdrawal type using bracket-estimated traditional rate
  const hsaWithdrawal =
    slots.find(
      (s) =>
        getAccountTypeConfig(s.category).balanceStructure === "single_bucket",
    )?.withdrawal ?? 0;
  const brokerageSlot = slots.find((s) => isOverflowTarget(s.category));
  const brokerageWithdrawal = brokerageSlot?.withdrawal ?? 0;
  // Re-estimate traditional rate on actual withdrawal amount (more accurate than pre-routing estimate)
  const actualTaxableIncome = totalTraditionalWithdrawal + taxableSS;
  const actualTraditionalRate =
    taxRates.taxBrackets && taxRates.taxBrackets.length > 0
      ? estimateEffectiveTaxRate(
          actualTaxableIncome,
          taxRates.taxBrackets,
          taxRates.taxMultiplier,
        )
      : taxRates.traditionalFallbackRate;

  // Basis-aware brokerage tax: only gains portion is taxable
  let brokerageTaxCost = 0;
  let brokerageBasisPortion = 0;
  let brokerageGainsPortion = 0;
  if (brokerageWithdrawal > 0 && balances.afterTax > 0) {
    const basisRatio = Math.min(1, balances.afterTaxBasis / balances.afterTax);
    brokerageBasisPortion = roundToCents(brokerageWithdrawal * basisRatio);
    brokerageGainsPortion = roundToCents(
      brokerageWithdrawal - brokerageBasisPortion,
    );
    // Progressive LTCG tax: stack gains on top of ordinary income across 0%/15%/20% brackets
    brokerageTaxCost = filingStatus
      ? roundToCents(
          computeLtcgTax(
            actualTaxableIncome,
            brokerageGainsPortion,
            filingStatus,
          ),
        )
      : roundToCents(brokerageGainsPortion * taxRates.brokerage);
    // Annotate the slot with basis/gains breakdown
    if (brokerageSlot) {
      brokerageSlot.basisPortion = brokerageBasisPortion;
      brokerageSlot.gainsPortion = brokerageGainsPortion;
    }
  }

  let taxCost = roundToCents(
    totalTraditionalWithdrawal * actualTraditionalRate +
      totalRothWithdrawal * taxRates.roth +
      hsaWithdrawal * taxRates.hsa +
      brokerageTaxCost,
  );

  // Recompute grossUpFactor post-RMD for accurate diagnostics (#45).
  // Pre-RMD estimate may understate tax when RMD forces additional Traditional withdrawals.
  if (rmdOverrodeRouting && afterTaxNeed > 0) {
    const postRmdEffRate = taxCost / (afterTaxNeed + taxCost);
    grossUpFactor =
      postRmdEffRate < 1 ? 1 / (1 - postRmdEffRate) : grossUpFactor;
  }

  // Deduct withdrawals from tax buckets and per-account balances -- extracted to balance-deduction.ts
  deductWithdrawals({ slots, balances, acctBal, brokerageBasisPortion });

  // Distribute withdrawals to individual accounts -- extracted to individual-account-tracking.ts
  const decIndWithdrawal = hasIndividualAccounts
    ? distributeWithdrawals(slots, indAccts, indKey, indBal)
    : new Map<string, number>();

  // Ensure no negative balances -- extracted to balance-deduction.ts
  clampBalances(balances, acctBal);

  // Apply decumulation lump sums (one-time injections/windfalls, NOT subject to limits)
  applyLumpSums(config.lumpSums, ctx, state);

  // Reinvest RMD excess into brokerage (#39) -- extracted to balance-deduction.ts
  const shouldReinvestRmdExcess = input.reinvestRmdExcess !== false; // default: true
  reinvestRmdExcess(
    shouldReinvestRmdExcess,
    rmdOverrodeRouting,
    totalWithdrawal,
    afterTaxNeed,
    taxCost,
    balances,
    acctBal,
  );

  // Clamp individual account balances -- extracted to individual-account-tracking.ts
  if (hasIndividualAccounts) {
    clampIndividualBalances(indAccts, indKey, indBal);
  }

  // Track per-account depletions -- extracted to balance-deduction.ts
  trackDepletions(acctBal, depletionTracked, accountDepletions, year, age);

  // --- Roth Conversions (Phase 4) ---
  // Extracted to post-withdrawal-optimizer.ts -- Roth conversion + IRMAA + ACA chain.
  const rothResult = performRothConversion({
    enableRothConversions: taxRates.enableRothConversions,
    taxBrackets: taxRates.taxBrackets,
    taxMultiplier: taxRates.taxMultiplier,
    rothConversionTarget: config.rothConversionTarget,
    rothBracketTarget:
      taxRates.rothConversionTarget ?? taxRates.rothBracketTarget,
    totalTraditionalWithdrawal,
    taxableSS,
    brokerageGainsPortion,
    irmaaAwareRothConversions:
      input.irmaaAwareRothConversions ??
      (enableIrmaaAwareness ? true : undefined),
    filingStatus,
    balances,
    acctBal,
  });
  const { rothConversionAmount, rothConversionTaxCost } = rothResult;

  // Recompute LTCG tax including Roth conversion income (#37).
  // Roth conversions are taxed as ordinary income and push total taxable income
  // into potentially higher LTCG brackets (0%/15%/20%).
  let postConversionLtcgRate: number;
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    const revisedOrdinary = actualTaxableIncome + rothConversionAmount;
    brokerageTaxCost = roundToCents(
      computeLtcgTax(revisedOrdinary, brokerageGainsPortion, filingStatus),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      revisedOrdinary + brokerageGainsPortion,
      filingStatus,
    );
    // Recompute taxCost with revised brokerage tax
    taxCost = roundToCents(
      totalTraditionalWithdrawal * actualTraditionalRate +
        totalRothWithdrawal * taxRates.roth +
        hsaWithdrawal * taxRates.hsa +
        brokerageTaxCost,
    );
  } else {
    // Display-only: marginal bracket at the ceiling of the gains stack.
    // No tax is actually computed from this value.
    postConversionLtcgRate =
      brokerageGainsPortion > 0 && filingStatus
        ? getLtcgRate(actualTaxableIncome + brokerageGainsPortion, filingStatus)
        : brokerageGainsPortion > 0
          ? taxRates.brokerage
          : filingStatus
            ? getLtcgRate(actualTaxableIncome, filingStatus)
            : taxRates.brokerage;
  }

  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  // Applies to lesser of net investment income or MAGI exceeding threshold.
  // Roth conversions raise MAGI but are NOT net investment income.
  const currentYearMagi =
    totalTraditionalWithdrawal +
    rothConversionAmount +
    brokerageGainsPortion +
    taxableSS;
  const niitAmount = filingStatus
    ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
    : 0;
  if (niitAmount > 0) {
    taxCost = roundToCents(taxCost + niitAmount);
  }

  // --- IRMAA Awareness (Phase 6) ---
  // Store MAGI for 2-year lookback (#18).
  magiHistory.push(currentYearMagi);
  // IRMAA uses year N-2 MAGI per IRS rules; fall back to current year for first 2 years.
  const irmaaLookbackMagi =
    magiHistory.length > 2
      ? magiHistory[magiHistory.length - 3]!
      : currentYearMagi;
  const personsAge65Plus =
    perPersonBirthYears && perPersonBirthYears.length > 0
      ? perPersonBirthYears.filter((by) => year - by >= MEDICARE_START_AGE)
          .length
      : age >= MEDICARE_START_AGE
        ? 1
        : 0;
  const anyPersonAge65 = personsAge65Plus > 0;
  const irmaaResult = checkIrmaa({
    enableIrmaaAwareness,
    filingStatus,
    anyPersonAge65,
    projectedMagi: irmaaLookbackMagi,
    rothConversionAmount,
  });
  // IRMAA surcharge is per-person — each Medicare-eligible person pays separately
  const irmaaCost = irmaaResult.irmaaCost * personsAge65Plus;
  routeWarnings.push(...irmaaResult.warnings);

  // --- ACA Subsidy Awareness (Phase 7) ---
  const allPersonsUnder65 =
    perPersonBirthYears && perPersonBirthYears.length > 0
      ? perPersonBirthYears.every((by) => year - by < 65)
      : age < 65;
  const acaResult = checkAca({
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize: householdSize ?? 2,
    totalTraditionalWithdrawal,
    rothConversionAmount,
    brokerageGainsPortion,
    taxableSS,
  });
  const { acaSubsidyPreserved, acaMagiHeadroom } = acaResult;
  routeWarnings.push(...acaResult.warnings);

  // Compute post-retirement Portfolio-category contributions for REPORTING ONLY.
  // The Portfolio page reads brokerageContribution from the engine output.
  // These amounts must NOT be added to balances — Portfolio-category accounts
  // are read-only balance inputs in the retirement engine.
  // parentCategory (user-editable) controls the boundary, not account type.
  const { brokerageContributionRamp, limitGrowthRate } = input;
  const lgf = Math.pow(1 + limitGrowthRate, y);
  let decumBrokerageContrib = 0;
  const decumContribByAccount = new Map<string, number>();
  if (state.contributionSpecs) {
    const portfolioSpecs = state.contributionSpecs.filter(
      (s) =>
        isPortfolioParent(s.parentCategory) &&
        s.retirementBehavior === "continues_after_retirement" &&
        s.method !== "percent_of_salary",
    );
    for (const spec of portfolioSpecs) {
      const amount = roundToCents(spec.baseAnnual * lgf);
      if (amount <= 0) continue;
      decumBrokerageContrib += amount;
      if (spec.accountName) {
        const matchingAccount = ctx.indAccts.find(
          (ia) => ia.name === spec.accountName,
        );
        if (matchingAccount) {
          const k = indKey(matchingAccount);
          decumContribByAccount.set(
            k,
            (decumContribByAccount.get(k) ?? 0) + amount,
          );
        }
      }
    }
  }
  // Portfolio contribution ramp (report-only — not applied to balances)
  const rampYear = Math.min(y, MAX_BROKERAGE_RAMP_YEARS);
  const decumRampAmount =
    (brokerageContributionRamp ?? 0) > 0 && y > 0
      ? roundToCents(brokerageContributionRamp! * rampYear)
      : 0;
  if (decumRampAmount > 0) {
    decumBrokerageContrib += decumRampAmount;
  }

  // Apply growth -- extracted to growth-application.ts
  applyGrowth({ effectiveReturn: returnRate, balances, acctBal });

  // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
  state.priorYearEndTradBalance = balances.preTax;
  updatePerPersonTradBalance(ctx, state);
  // Update spending strategy state: prior year return + spending
  spendingState.priorYearReturn = returnRate;
  spendingState.priorYearSpending = state.projectedExpenses;
  // Per-individual-account growth (decumulation) -- extracted to individual-account-tracking.ts
  const decIndGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, returnRate, true)
    : new Map<string, number>();

  // Use the contribution map built during the brokerage contribution block above
  const decIndContribs =
    decumContribByAccount.size > 0 ? decumContribByAccount : undefined;

  // Build individual account year balances (decumulation) -- extracted to individual-account-tracking.ts
  const decIndYearBalances: IndividualAccountYearBalance[] =
    hasIndividualAccounts
      ? buildIndividualYearBalances(
          indAccts,
          indKey,
          indBal,
          indParentCat,
          "decumulation",
          {
            contribs: decIndContribs,
            growth: decIndGrowth,
            withdrawal: decIndWithdrawal,
          },
        )
      : [];

  // Zero out rounding dust -- extracted to balance-deduction.ts
  cleanupDust(balances, acctBal, indAccts, indKey, indBal);
  const endBalance = roundToCents(
    balances.preTax + balances.taxFree + balances.hsa + balances.afterTax,
  );

  // Track depletion
  if (endBalance < 1 && state.portfolioDepletionYear === null) {
    state.portfolioDepletionYear = year;
    state.portfolioDepletionAge = age;
  }

  const yearProjection: EngineDecumulationYear = {
    year,
    age,
    phase: "decumulation",
    projectedExpenses: roundToCents(state.projectedExpenses),
    hasBudgetOverride: budgetOverrideMap.has(year),
    brokerageContribution: decumBrokerageContrib,
    brokerageRampContribution: decumRampAmount,
    targetWithdrawal,
    config,
    slots,
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    taxCost,
    effectiveTaxRate: totalWithdrawal > 0 ? taxCost / totalWithdrawal : 0,
    ssIncome,
    ssIncomeByPerson,
    afterTaxNeed,
    grossUpFactor,
    estTraditionalPortion,
    bracketTraditionalCap: routeResult.traditionalCap,
    unmetNeed: routeResult.unmetNeed,
    preWithdrawalAcctBal,
    endBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: decIndYearBalances,
    returnRate,
    annualizedReturnRate: returnRate,
    rmdAmount,
    rmdByPerson,
    rmdOverrodeRouting,
    taxableSS,
    ltcgRate: postConversionLtcgRate,
    rothConversionAmount,
    rothConversionTaxCost,
    strategyAction,
    niitAmount,
    irmaaCost,
    acaSubsidyPreserved,
    acaMagiHeadroom,
    warnings: routeWarnings,
  };

  state.projectionByYear.push(yearProjection);
}
