/**
 * runDecumulationYear — single-year decumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 */
import { socialSecurityForYear } from "../social-security-income";
import {
  followDraws,
  followReconciliation,
  retirementBrokerageBasisRatio,
  syncAggregateBasis,
} from "../brokerage-basis";
import type { EngineDecumulationYear } from "../types/projection-result";
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
  nonMedicalPenaltyRate,
} from "../../../config/account-types";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { countReachingAgeRule } from "@/lib/pure/household/age";
import { cloneAccountBalances, scopedBalances } from "../balance-utils";
import {
  growWithholdingBrackets,
  growLtcgBrackets,
  growIrmaaBrackets,
  taxTableYears,
} from "../bracket-growth";
import { resolveDecumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import { routeForMode } from "../withdrawal-routing";
import { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import { checkAca } from "../post-withdrawal-optimizer";
import { checkHouseholdIrmaa } from "../household-irmaa";
import {
  distributeWithdrawals,
  applyIndividualGrowth,
  buildIndividualYearBalances,
  depleteIndividualBasis,
  clampIndividualBasis,
  reconcileIndividualToAggregate,
  specKeyOf,
  portfolioFirst,
} from "../individual-account-tracking";
import {
  computeNonRetirementExclusion,
  computeWithdrawalEligibility,
} from "@/lib/pure/accounts/eligibility";
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/accounts/early-withdrawal-penalty";
import { cleanupDust } from "../balance-deduction";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { updatePerPersonTradBalance } from "./helpers";
import { rmdIncomeByOwner } from "./decumulation-income";
import { enforceYearRmd, qcdStep } from "./rmd-step";
import { yearStandardDeduction } from "./year-deduction";
import {
  priceYearTax,
  pricedYearParts,
  repriceConversionYear,
  settleYearDraws,
  yearRothConversion,
} from "./tax-year-settlement";
import { fundingShortfallForYear } from "./funding-shortfall";
import { yearNeed } from "./year-need";
import { yearMagi } from "@/lib/pure/tax/year-income";

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
  yearIndex: number,
  setup: PreYearSetup,
): void {
  const {
    age,
    year,
    returnRate,
    strategyAction,
    retirementBalance,
    totalBalance,
  } = setup;
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
    indBasis,
    brokBasis,
    spendingState,
    incomeHistory,
    depletionTracked,
    accountDepletions,
  } = state;

  const {
    decumulationDefaults,
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

  // Withdrawal-ordering eligibility --
  // per-account penalty-free/locked split for this projected year. Computed
  // once, here, BEFORE either routeForMode call site (this function's real
  // execution below and withdrawal-solver.ts's independent estimate) -- both
  // must see the exact same eligibility record, or the gross-up estimate
  // would target money the real router can't (or won't prefer to) reach,
  // desyncing the tax estimate from actual routing (the single-dispatch
  // invariant routeForMode exists to preserve). Computed unconditionally
  // when individual accounts exist -- Tier A (distributeWithdrawals) has no
  // config lever and always applies; routeForMode itself checks
  // config.avoidPenalizedWithdrawals before using this for Tier B. indAccts
  // already carry their own ruleOf55/rothBasisMeta/ownerBirthYear ("now"
  // data, threaded by build-engine-payload.ts Group 1.1); this recomputes
  // locked/eligible fresh for the current projected `year` via
  // projectRuleOf55. `indBasis` (tracked Roth basis follow-up) is passed
  // through so the gate reads the SAME running basis figure the UI shows
  // -- reading a stale snapshot for the gate while showing tracked basis
  // in the tooltip would be two numbers for one quantity (see
  // withdrawal-eligibility.ts's docblock).
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({ year, indAccts, indBal, indKey, indBasis })
    : undefined;
  // Portfolio-parented accounts (e.g. a taxable brokerage the
  // household doesn't consider part of the retirement plan) never fund
  // retirement spending need — computed once per year here, threaded to
  // every consumer that decides how much money is "available"
  // (routeForMode's two call sites, performRothConversion, enforceRmd, and
  // QCD's capacity/debit below) so they can't disagree with each other.
  const { nonRetirement } = setup;

  // Reconciliation check: acctBal Roth total should match balances.taxFree
  const acctBalRothTotal = getAllCategories().reduce((s, cat) => {
    const b = acctBal[cat];
    return s + (b.structure === "roth_traditional" ? b.roth : 0);
  }, 0);
  const rothDivergence =
    Math.abs(acctBalRothTotal - balances.taxFree) > 1
      ? `[DIAG] Roth divergence: acctBal.roth=${acctBalRothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - acctBalRothTotal).toFixed(0)}`
      : null;

  // Social Security income reduces withdrawal need (per person from each
  // one's own start age).
  const { ssIncome, ssIncomeByPerson } = socialSecurityForYear(
    input,
    year,
    age,
    ctx.inflation.growth(year - input.asOfDate.getFullYear()),
  );
  const { perOwnerRmd, perPersonRmdTotal, rmdByPerson } = rmdIncomeByOwner(
    year,
    input,
    ctx,
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    priorYearEndTradByPerson,
  );

  const { totalQcd, qcdByPerson } = qcdStep(
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    year,
    indAccts,
    ctx,
    indBal,
    indKey,
    decumulationDefaults,
    config,
    balances,
    acctBal,
  );

  // The brokerage basis ratio of this year's retirement withdrawals: the
  // Retirement brokerages' own (start of year). One ratio for the
  // estimate, the ranking and the real tax.
  const retirementBasisRatio = hasIndividualAccounts
    ? retirementBrokerageBasisRatio(indAccts, indKey, indBal, brokBasis)
    : undefined;

  // Tax gross-up: estimate tax from expected withdrawal routing, then
  // increase withdrawal so after-tax proceeds cover the expense need.
  const taxRates = decumulationDefaults.distributionTaxRates;
  // Retirement money only (PreYearSetup.retirementBalance): Portfolio-
  // parented Traditional money is never withdrawn for spending, so it can't
  // be part of the estimate.
  const retirementPreTax =
    balances.preTax -
    (nonRetirement ? sumBy(Object.values(nonRetirement.trad), (v) => v) : 0);
  const estTraditionalPortion =
    retirementBalance > 0
      ? Math.max(0, retirementPreTax) / retirementBalance
      : 0;

  // Grow the ordinary tax brackets + standard deduction forward from their
  // own DB vintage:
  // both are legally inflation-indexed but were being held flat in NOMINAL
  // dollars for the whole projection while nominal income/spending
  // correctly grows, silently overstating tax burden in later years. See
  // `bracket-growth.ts`'s header for the full account, including why this
  // is NOT the same mistake as the (reverted) NIIT threshold change —
  // NIIT/SS-taxation thresholds are genuinely flat-nominal by law and are
  // deliberately NOT touched here.
  //
  // One factor per table per year, each from that table's own year
  // (taxTableYears — the table and its year come together). The standard
  // deduction grows from the limits year; withholding brackets from
  // theirs. When the two share a year they share the factor; when they
  // don't, each still estimates year y, so `toOrdinaryBracketIncome`'s
  // residual stays correct (bracket-growth.ts).
  const tableYears = taxTableYears(taxRates);
  const taxGrowth = ctx.inflation.growthSinceVintage(
    year,
    tableYears.standardDeduction,
  );
  const bracketGrowth = ctx.inflation.growthSinceVintage(
    year,
    tableYears.brackets,
  );
  const grownTaxBrackets = taxRates.taxBrackets
    ? growWithholdingBrackets(taxRates.taxBrackets, bracketGrowth)
    : undefined;
  const { grownStandardDeduction } = yearStandardDeduction(
    perPersonBirthYears,
    year,
    age,
    taxRates,
    incomeHistory,
    taxGrowth,
  );
  // Phase 2: LTCG brackets, grown from their own year.
  const grownLtcgBrackets = growLtcgBrackets(
    taxRates.ltcgBrackets,
    ctx.inflation.growthSinceVintage(year, tableYears.ltcg),
  );

  // Phase 3: IRMAA brackets, grown from their own year (tableYears.irmaa).
  //
  // TWO different growth factors, not one -- this is not a copy-paste
  // duplication, it answers two different questions:
  //  - grownIrmaaBracketsForCheck (checkHouseholdIrmaa, below): "what
  //    surcharge schedule applies THIS calendar year" -- anchored on `year`.
  //  - grownIrmaaBracketsForCap (performRothConversion, above -- passed
  //    in via rothResult's call below): "what surcharge schedule will
  //    apply when THIS year's MAGI is looked back at" -- IRMAA has a
  //    2-year lookback (year N's MAGI sets year N+2's premium), so the
  //    cap must compare this year's MAGI against the N+2 vintage of the
  //    threshold, not N's -- anchored on `year + 2`. Using the same
  //    factor for both would silently UNDER-cap every conversion by two
  //    years of real threshold growth.
  const irmaaGrowthCheck = ctx.inflation.growthSinceVintage(
    year,
    tableYears.irmaa,
  );
  const irmaaGrowthCap = ctx.inflation.growthSinceVintage(
    year,
    tableYears.irmaa,
    2,
  );
  const grownIrmaaBracketsForCheck = growIrmaaBrackets(
    taxRates.irmaaBrackets,
    irmaaGrowthCheck,
  );
  const grownIrmaaBracketsForCap = growIrmaaBrackets(
    taxRates.irmaaBrackets,
    irmaaGrowthCap,
  );

  // Phase 4: ACA subsidy cliff (400% FPL), grown from its own coverage
  // year (tableYears.fpl). One factor (unlike IRMAA's two): ACA premium
  // tax credits are computed on the coverage
  // year's OWN income, no multi-year MAGI lookback the way Medicare's
  // IRMAA has, so `checkAca` (single call site, no conversion-capping
  // analog to IRMAA's `irmaaAwareRothConversions`) just needs "this
  // year's" vintage.
  const fplGrowthFactor = ctx.inflation.growthSinceVintage(
    year,
    tableYears.fpl,
  );

  const personsAge65Plus = countReachingAgeRule(
    perPersonBirthYears,
    age,
    "medicare",
    year,
  );
  const { afterTaxNeed, ssSurplus, taxEst, targetWithdrawal } = yearNeed(
    state,
    ssIncome,
    input,
    incomeHistory,
    enableIrmaaAwareness,
    filingStatus,
    personsAge65Plus,
    grownIrmaaBracketsForCheck,
    config,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    balances,
    acctBal,
    totalBalance,
    retirementBasisRatio,
    eligibility,
    nonRetirement,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indBal,
    indBasis,
    year,
  );

  // Build per-account, per-tax-type balances for withdrawal routing
  // Uses real per-account balances tracked through accumulation
  const acctBalances = acctBal;
  const preWithdrawalAcctBal = cloneAccountBalances(acctBal);

  // Route withdrawals based on configured mode -- single dispatch point
  // shared with withdrawal-solver.ts's estimate (routeForMode in
  // withdrawal-routing.ts), so a routing-mode-specific rule (like the Roth
  // bracket overlay below) can't diverge between the estimate and real
  // execution.
  // bracket_filling: tax-optimal -- fills traditional up to bracket cap, Roth for rest
  // waterfall: sequential drain in priority order (legacy behavior)
  // percentage: fixed % split across accounts
  //
  // For waterfall, Roth bracket optimization can still overlay via
  // rothBracketTarget (a Traditional cap that yields to spending once the
  // other accounts are done). Percentage mode has no overlay.
  // Cost-aware post-bracket-cap ranking inputs
  // (bracket_filling mode only; ignored by waterfall/percentage). See
  // deriveBasisRankingInputs's docblock for why the basis-derived fields
  // are shared with withdrawal-solver.ts's estimate.
  //
  // magiBeforeThisDraw is omitted: NIIT's MAGI has no lookback, so the
  // router's `?? baseOrdinaryFloor` (this year's pre-draw figure) applies,
  // as in withdrawal-solver.ts's estimate.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    brokerageBasisRatio: retirementBasisRatio,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBal: hasIndividualAccounts ? indBal : undefined,
    year,
  });

  // Resolved ONCE, here, and reused both for the routing reservation below
  // AND for performRothConversion's own target further down (replacing
  // that call's separate re-derivation of the identical fallback chain) —
  // conversionReservedRoom used to reserve
  // room up to `traditionalCap` (derived from bracketInfo.rothBracketTarget,
  // the WITHDRAWAL target) even though the conversion that actually runs
  // later this same year targets this resolved value instead, which can
  // differ (an explicit plan-level rothConversionTarget below the
  // household's rothBracketTarget). Two names for one quantity, resolved
  // by two different chains, biased the discretionary-tier ranking away
  // from brokerage in that configuration — not a wrong final dollar
  // amount (routing degrades to the next tier when a reservation can't be
  // filled), but a real ordering bug for the exact household shape
  // roth-conversion-target-priority.test.ts already covers.
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
      // Read the resolved (possibly per-year-overridden)
      // value first, falling back to the plan's fixed default — was
      // previously always the fixed default, with no override path at all.
      // rothBracketTarget is a RATE (e.g. 0.12), not a dollar figure —
      // growth-invariant, deliberately not grown.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      // The rate performRothConversion will ACTUALLY convert up to, when
      // it differs from the withdrawal target above — see this const's
      // own comment. Only meaningful when conversionsEnabled.
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

  const {
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    rmdDivisor,
    ownerRmd,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    rmdAmount,
  } = enforceYearRmd(
    slots,
    perOwnerRmd,
    rmdStartAge,
    age,
    priorYearEndTradBalance,
    rmdByPerson,
    qcdByPerson,
    ctx,
    acctBal,
    indAccts,
    indKey,
    indBal,
    nonRetirement,
    routeWarnings,
    state,
    perPersonRmdTotal,
  );

  // Distribute withdrawals to individual accounts -- extracted to individual-account-tracking.ts
  // Moved ABOVE computeTaxFromSlots: tax computation needs
  // this year's BasisDraws to know how much of each Roth withdrawal was
  // growth (taxable, if non-qualified) vs. basis (always tax-free). Safe
  // to hoist: distributeWithdrawals/depleteIndividualBasis mutate only
  // indBal/indBasis, never balances/acctBal, which is all
  // computeTaxFromSlots reads. deductWithdrawals (which DOES mutate
  // balances/acctBal) stays below, after tax, unchanged.
  // Snapshot indBal BEFORE distributeWithdrawals mutates it in place --
  // depleteIndividualBasis needs the pre-withdrawal balance for its
  // pro-rata ratio.
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

  // Roth growth-vs-basis taxability -- consumes this year's
  // BasisDraws (never re-slices), decides per-account whether the
  // already-sliced growth portion is taxable (non-qualified distribution:
  // owner under 59 1/2). Undefined ownerBirthYear (joint accounts) is
  // treated as qualified, matching withdrawal-eligibility.ts.
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

  // Early-withdrawal penalty cost -- consumes this
  // year's real per-account withdrawal map (never re-slices). Under the
  // default avoidPenalizedWithdrawals: true, routeForMode already excluded
  // penalty-exposed money from routing, so this should compute exactly 0 in
  // the common case -- it prices whatever was actually withdrawn, whatever
  // the reason (including the lever being off).
  const earlyWithdrawalPenalty =
    hasIndividualAccounts && eligibility
      ? computeEarlyWithdrawalPenalty({
          exposure: eligibility,
          withdrawnByKey: decIndWithdrawal,
        })
      : { penaltyCost: 0, penalizedAmount: 0, byKey: new Map() };

  const { priceTax, taxableSS, taxFromSlots } = priceYearTax(
    slots,
    balances,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    filingStatus,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    rothTaxSplit,
    earlyWithdrawalPenalty,
    brokerageBasisRatio,
    taxEst,
    ssIncome,
  );
  const {
    brokerageBasisPortion,
    brokerageGainsPortion,
    actualTaxableIncome,
    penaltyCost,
    ssTaxCost,
    surplusCredit,
    grossUpFactor,
  } = pricedYearParts(
    taxFromSlots,
    slots,
    balances,
    ssSurplus,
    taxEst,
    rmdOverrodeRouting,
    afterTaxNeed,
    state,
  );

  const { rmdExcessAmount } = settleYearDraws(
    slots,
    balances,
    acctBal,
    brokerageBasisPortion,
    indAccts,
    indKey,
    indBal,
    brokBasis,
    config,
    ctx,
    state,
    taxFromSlots,
    surplusCredit,
    rmdOverrodeRouting,
    totalWithdrawal,
    afterTaxNeed,
    hasIndividualAccounts,
    depletionTracked,
    accountDepletions,
    year,
    age,
  );

  const {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  } = yearRothConversion(
    config,
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    indAccts,
    ctx,
    indBal,
    indKey,
    year,
    balances,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    targetWithdrawal,
    brokBasis,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    resolvedConversionTarget,
    taxableSS,
    taxFromSlots,
    brokerageGainsPortion,
    input,
    enableIrmaaAwareness,
    grownIrmaaBracketsForCap,
    filingStatus,
    acctBal,
    nonRetirement,
  );

  const { taxCost, postConversionLtcgRate, income, niitAmount } =
    repriceConversionYear(
      taxFromSlots,
      actualTaxableIncome,
      rothConversionAmount,
      grownStandardDeduction,
      filingStatus,
      brokerageGainsPortion,
      grownLtcgBrackets,
      priceTax,
      taxableSS,
      taxRates,
      totalTraditionalWithdrawal,
      ssIncome,
    );

  const {
    deliveredAfterTax,
    shortfallMaterialityFloor,
    finalUnmetNeed,
    unmetNeedMaterial,
  } = fundingShortfallForYear(
    totalWithdrawal,
    taxCost,
    penaltyCost,
    state,
    afterTaxNeed,
    surplusCredit,
    routedUnmetNeed,
    taxRates,
  );

  // --- IRMAA Awareness (Phase 6) ---
  // This year's income, for next years' lookbacks.
  incomeHistory.push(income);
  // IRMAA uses year N-2 MAGI per IRS rules; fall back to current year for first 2 years.
  const irmaaLookbackMagi = yearMagi(
    incomeHistory.length > 2 ? incomeHistory.at(-3)! : income,
    "irmaa",
  );
  const irmaaResult = checkHouseholdIrmaa({
    enableIrmaaAwareness,
    filingStatus,
    personsAge65Plus,
    projectedMagi: irmaaLookbackMagi,
    rothConversionAmount,
    irmaaBrackets: grownIrmaaBracketsForCheck,
  });
  const irmaaCost = irmaaResult.irmaaCost;
  const irmaaPaid = input.irmaaOnTopOfBudget === true ? irmaaCost : 0;
  routeWarnings.push(...irmaaResult.warnings);

  // --- ACA Subsidy Awareness (Phase 7) ---
  // Under-65 is the ACA marketplace-subsidy eligibility criterion this
  // checks — it's the same real-world Medicare-eligibility event the IRMAA
  // block above tests, not an independent regulatory threshold, so it
  // shares AGE_RULES.medicare.
  const allPersonsUnder65 = personsAge65Plus === 0;
  const acaResult = checkAca({
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize: householdSize ?? 2,
    income,
    fplGrowthFactor,
    fplByHousehold: taxRates.fplByHousehold,
  });
  const { acaSubsidyPreserved, acaMagiHeadroom } = acaResult;
  routeWarnings.push(...acaResult.warnings);

  // Compute post-retirement Portfolio-category contributions for REPORTING ONLY.
  // The Portfolio page reads brokerageContribution from the engine output.
  // These amounts must NOT be added to balances — Portfolio-category accounts
  // are read-only balance inputs in the retirement engine.
  // parentCategory (user-editable) controls the boundary, not account type.
  const { brokerageContributionRamp, limitGrowthRate } = input;
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex);
  let decumBrokerageContrib = 0;
  const decumContribByAccount = new Map<string, number>();
  if (state.contributionSpecs) {
    const portfolioSpecs = state.contributionSpecs.filter(
      (s) =>
        !isRetirementMoney(s.parentCategory) &&
        s.retirementBehavior === "continues_after_retirement" &&
        s.method !== "percent_of_salary",
    );
    for (const spec of portfolioSpecs) {
      const amount = roundToCents(spec.baseAnnual * lgf);
      if (amount <= 0) continue;
      decumBrokerageContrib += amount;
      if (spec.accountName) {
        // This used to match by
        // `ia.name === spec.accountName` alone — two household members with
        // identically-named accounts (e.g. both "Traditional 401(k)") would
        // silently collide, with whichever account `indAccts` happened to
        // list first absorbing every match regardless of whose contribution
        // spec it actually was. `state.specToAccount` (built once per year
        // by `buildSpecToAccountMapping`, individual-account-tracking.ts —
        // the SAME owner-aware category+owner+taxType+parentCategory
        // cascade `accumulation-year.ts` already uses for this exact
        // spec-to-account question) is the single computation path for
        // "which individual account does this spec belong to" — reusing it
        // here instead of re-deriving a second, weaker match avoids
        // RULES.md's single-computation-path trap. Falls back to the old
        // name-only match only when the spec has no entry in the map at
        // all (shouldn't happen for a spec with a resolved accountName, but
        // keeps this from going from "matches something" to "matches
        // nothing" for an edge case buildSpecToAccountMapping doesn't cover).
        const matchedKey = state.specToAccount.get(specKeyOf(spec));
        const matchingAccount = matchedKey
          ? ctx.indAccts.find((ia) => indKey(ia) === matchedKey)
          : ctx.indAccts.find((ia) => ia.name === spec.accountName);
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
  const rampYear = Math.min(yearIndex, MAX_BROKERAGE_RAMP_YEARS);
  const decumRampAmount =
    (brokerageContributionRamp ?? 0) > 0 && yearIndex > 0
      ? roundToCents(brokerageContributionRamp! * rampYear)
      : 0;
  if (decumRampAmount > 0) {
    decumBrokerageContrib += decumRampAmount;
    // Attribute the ramp to individual overflow-target (brokerage) accounts,
    // weighted by balance, so the per-account breakdown sums to the total.
    // Mirrors accumulation-year.ts's ramp attribution — report-only here,
    // matching the rest of this block (must NOT affect balances).
    // Same parent rule as the accumulation ramp: Portfolio brokerages
    // first; the projection-only one only with no real brokerage.
    const brokerages = indAccts.filter((ia) => isOverflowTarget(ia.category));
    const realBrokerages = brokerages.filter((ia) => !ia.projectedOnly);
    const rampAccts =
      realBrokerages.length > 0
        ? portfolioFirst(realBrokerages, (ia) => ia.parentCategory)
        : brokerages;
    const rampTotal = rampAccts.reduce(
      (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of rampAccts) {
      const k = indKey(ia);
      const weight =
        rampTotal > 0 ? (indBal.get(k) ?? 0) / rampTotal : 1 / rampAccts.length;
      const portion = roundToCents(decumRampAmount * weight);
      decumContribByAccount.set(
        k,
        (decumContribByAccount.get(k) ?? 0) + portion,
      );
    }
  }

  // Apply growth -- extracted to growth-application.ts
  applyGrowth({ effectiveReturn: returnRate, balances, acctBal });

  // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
  state.priorYearEndTradBalance = balances.preTax;
  // Update spending strategy state: prior year return + spending
  spendingState.priorYearReturn = returnRate;
  spendingState.priorYearSpending = state.projectedExpenses;
  // Per-individual-account growth (decumulation) -- extracted to individual-account-tracking.ts
  const decIndGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, returnRate, true)
    : new Map<string, number>();
  // Each owner's RMD base is year-end, after growth — like the household's
  // above and accumulation's.
  updatePerPersonTradBalance(ctx, state);

  // Use the contribution map built during the brokerage contribution block above
  const decIndContribs =
    decumContribByAccount.size > 0 ? decumContribByAccount : undefined;

  // Tracked Roth basis: clamp to this year's balance
  // before building output -- market losses (or a shrunk-to-near-zero
  // account) could otherwise leave tracked basis exceeding what the
  // account actually holds. Mirrors early-access.ts's own balance clamp
  // (clampBasisToBalance's docblock).
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccts, indKey, indBasis, indBal);
  }

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
            basis: indBasis,
            draws: basisDraws,
            brokerageBasis: brokBasis,
          },
          eligibility,
        )
      : [];

  // Zero out rounding dust -- extracted to balance-deduction.ts
  followDraws(indAccts, indKey, indBal, brokBasis, () =>
    cleanupDust(balances, acctBal, indAccts, indKey, indBal),
  );

  // Reconcile indBal to acctBal once per year -- the two tracks are
  // "known to drift" (see withdrawal-eligibility.ts's module docblock);
  // left unreconciled, next year's
  // eligibility gate can see a nonzero "eligible" balance for a category
  // that's actually 100% locked. Runs AFTER cleanupDust so it reads final
  // aggregate state for the year, and BEFORE the basis re-clamp below so
  // tracked basis clamps to the reconciled (not pre-reconciliation) balance.
  if (hasIndividualAccounts) {
    routeWarnings.push(
      ...followReconciliation(
        indAccts,
        indKey,
        indBal,
        brokBasis,
        balances.afterTaxBasis,
        () => reconcileIndividualToAggregate(indAccts, indKey, indBal, acctBal),
      ),
    );
    // The aggregate basis is the accounts' sum.
    syncAggregateBasis(
      indAccts,
      indKey,
      indBal,
      brokBasis,
      balances,
      acctBal,
      routeWarnings,
    );
  }

  // Re-clamp basis after dust cleanup -- a balance dust-cleaned to exactly
  // $0 must carry $0 basis into next year's state, even though this
  // year's already-built output row reflects the pre-dust-cleanup figure
  // (the dust amount is by definition negligible).
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccts, indKey, indBasis, indBal);
  }
  const yearEnd = scopedBalances(
    balances,
    hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccts, indBal, indKey)
      : undefined,
  );

  // Track depletion: retirement money running out (Portfolio money is
  // never spent in retirement, so it can't keep a plan alive).
  if (yearEnd.retirementBalance < 1 && state.retirementDepletionYear === null) {
    state.retirementDepletionYear = year;
    state.retirementDepletionAge = age;
  }

  const yearProjection: EngineDecumulationYear = {
    year,
    age,
    phase: "decumulation",
    projectedExpenses: roundToCents(state.projectedExpenses),
    spending: roundToCents(
      deliveredAfterTax -
        irmaaPaid -
        (config.rmdExcessHandling === "reinvest" ? rmdExcessAmount : 0) +
        ssIncome,
    ),
    withdrawalSized: state.portfolioWithdrawal !== null,
    budgetOnlyExpenses: roundToCents(state.budgetOnlyExpenses),
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
    // On the withdrawal: tax on Social Security is owed whether or not
    // anything is withdrawn (`ssTaxCost`, shown on its own line).
    effectiveTaxRate:
      totalWithdrawal > 0 ? (taxCost - ssTaxCost) / totalWithdrawal : 0,
    ssTaxCost,
    ssIncome,
    ssIncomeByPerson,
    afterTaxNeed,
    grossUpFactor,
    estTraditionalPortion,
    bracketTraditionalCap: routeResult.traditionalCap,
    standardDeduction: grownStandardDeduction,
    discretionaryTierBreakdown: routeResult.tierBreakdown,
    rothBasisCapacity: routeResult.rothBasisCapacity,
    brokerageZeroLtcgCapacity: routeResult.brokerageZeroLtcgCapacity,
    unmetNeed: finalUnmetNeed,
    unmetNeedMaterial,
    shortfallMaterialityFloor,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
    penaltyCost,
    deliveredAfterTax,
    penaltyLockedStillExcluded: eligibility
      ? roundToCents(
          sumBy(
            getAllCategories().filter((c) => nonMedicalPenaltyRate(c) == null),
            (c) => eligibility.penaltyExposedTotalStillExcluded[c],
          ),
        )
      : undefined,
    preWithdrawalAcctBal,
    retirementBalance: yearEnd.retirementBalance,
    allAccountsBalance: yearEnd.allAccountsBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: decIndYearBalances,
    returnRate,
    annualizedReturnRate: returnRate,
    rmdAmount,
    rmdByPerson,
    rmdDivisor,
    priorYearEndTradBalance,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    ...(ownerRmd && ownerRmd.rmdReassignedAmount > 0
      ? { rmdReassignedAmount: ownerRmd.rmdReassignedAmount }
      : {}),
    rmdExcessAmount,
    rmdSmoothingShortfall,
    qcdAmount: totalQcd,
    qcdByPerson: qcdByPerson.length > 0 ? qcdByPerson : undefined,
    taxableSS,
    ltcgRate: postConversionLtcgRate,
    rothConversionAmount,
    rothConversionTaxCost,
    rothConversionIrmaaCapped,
    strategyAction,
    niitAmount,
    irmaaCost,
    ...(irmaaPaid > 0 ? { irmaaPaid } : {}),
    acaSubsidyPreserved,
    acaMagiHeadroom,
    warnings: routeWarnings,
  };

  state.projectionByYear.push(yearProjection);
}
