/**
 * runDecumulationYear — single-year decumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 refactor. Pure relocation — no logic changes, behavior byte-identical.
 */
import type {
  EngineDecumulationYear,
  IndividualAccountYearBalance,
} from "../../types";
import { roundToCents, sumBy } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import {
  getAllCategories,
  isOverflowTarget,
  isPortfolioParent,
  isPreTaxType,
  isIraCategory,
  addTraditional,
} from "../../../config/account-types";
import { computeQcdAmounts, totalQcdAmount } from "../qcd";
import { computeRmdSmoothingTargets } from "../rmd-smoothing";
import {
  MAX_BROKERAGE_RAMP_YEARS,
  QCD_MIN_ELIGIBILITY_AGE,
} from "../../../constants";
import { cloneAccountBalances } from "../balance-utils";
import { getLtcgRate, computeLtcgTax } from "../../../config/tax-tables";
import { computeNiit } from "../../../config/niit";
import { resolveDecumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import { computeTaxableSS, computeTaxFromSlots } from "../tax-estimation";
import { estimateWithdrawalTaxCost } from "../tax-gross-up";
import { routeForMode } from "../withdrawal-routing";
import { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
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
  depleteIndividualBasis,
  clampIndividualBasis,
  reconcileIndividualToAggregate,
} from "../individual-account-tracking";
import {
  computeWithdrawalEligibility,
  computeNonRetirementExclusion,
} from "@/lib/pure/withdrawal-eligibility";
import type { BasisDraw } from "@/lib/pure/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/early-withdrawal-penalty";
import {
  deductWithdrawals,
  clampBalances,
  reinvestRmdExcess,
  trackDepletions,
  cleanupDust,
} from "../balance-deduction";
import { computeRmdAmount } from "../../../config/rmd-tables";
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
  yearIndex: number,
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
    indBasis,
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

  // Withdrawal-ordering eligibility (v0.7.8, PLAN-v0.7.8-v4 Group 2.2) --
  // per-account penalty-free/locked split for this projected year. Computed
  // once, here, BEFORE either routeForMode call site (this function's real
  // execution below and tax-gross-up.ts's independent estimate) -- both
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
  // withdrawal-eligibility.ts's docblock and
  // DESIGN-DECISION-v0.7.8-tracked-basis.md § Q6).
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({ year, indAccts, indBal, indKey, indBasis })
    : undefined;
  // R49: Portfolio-parented accounts (e.g. a taxable brokerage the
  // household doesn't consider part of the retirement plan) never fund
  // retirement spending need — computed once per year here, threaded to
  // every consumer that decides how much money is "available"
  // (routeForMode's two call sites, performRothConversion, enforceRmd, and
  // QCD's capacity/debit below) so they can't disagree with each other.
  // See .scratch/docs/plans/PLAN-retirement-only-withdrawal-scope.md.
  const nonRetirement = hasIndividualAccounts
    ? computeNonRetirementExclusion(indAccts, indBal, indKey)
    : undefined;

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
    { personId: number; personName: string; amount: number }[] | undefined;
  if (input.socialSecurityEntries && input.socialSecurityEntries.length > 0) {
    ssIncomeByPerson = input.socialSecurityEntries.map((entry) => {
      const personAge = ageInYear(entry.birthYear, year);
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

  // --- Per-person RMD (moved ahead of routing/tax gross-up, R46) ---
  // Compute each person's RMD from their own Traditional balance and age.
  // Previously computed AFTER routing (only needed for enforceRmd's
  // override), but R46's QCD step needs the RMD amount BEFORE tax
  // gross-up runs -- a QCD reduces taxable income for the year, so it has
  // to be known (and deducted) before estimateWithdrawalTaxCost, not
  // after. Pure computation, no dependency on routing -- safe to hoist.
  let perPersonRmdTotal: number | undefined;
  let rmdByPerson:
    { personId: number; personName: string; amount: number }[] | undefined;
  if (rmdStartAgeByPerson.size > 0 && priorYearEndTradByPerson.size > 0) {
    rmdByPerson = [];
    let total = 0;
    for (const [personId, { startAge, birthYear }] of rmdStartAgeByPerson) {
      const personAge = ageInYear(birthYear, year);
      const personTrad = priorYearEndTradByPerson.get(personId) ?? 0;
      if (personAge >= startAge && personTrad > 0) {
        const rmdAmount = computeRmdAmount(personTrad, personAge);
        if (rmdAmount != null) {
          rmdByPerson.push({
            personId,
            personName:
              input.socialSecurityEntries?.find((e) => e.personId === personId)
                ?.personName ?? `Person ${personId}`,
            amount: rmdAmount,
          });
          total += rmdAmount;
        }
      }
    }
    if (total > 0) perPersonRmdTotal = roundToCents(total);
  }

  // --- Qualified Charitable Distribution (R46) ---
  // A QCD is a direct IRA-to-charity transfer that satisfies part of the
  // RMD without counting as taxable income -- a proactive election on the
  // RMD itself, not a rule for leftover money (see reinvestRmdExcess for
  // that, unchanged, later in this function). Must run here, BEFORE tax
  // gross-up, so the reduced taxable Traditional withdrawal is what
  // estimateWithdrawalTaxCost/routing/computeTaxFromSlots all see -- see
  // qcd.ts's docblock for the IRA-only-pooling approximation this uses.
  // Only meaningful with individual accounts tracked (same limitation
  // per-person RMD itself already has).
  //
  // Eligibility is QCD_MIN_ELIGIBILITY_AGE (70), NOT rmdByPerson's
  // RMD-start-age gate (advisor review, 2026-08-29) -- QCD eligibility
  // predates SECURE 2.0's RMD-age delay, so someone with startAge 75 is
  // still QCD-eligible for years before any RMD is even required. Built
  // straight from rmdStartAgeByPerson (has every tracked person's
  // birthYear) rather than reusing rmdByPerson, which only contains
  // people who've already reached their RMD start age.
  let totalQcd = 0;
  let qcdByPerson: { personId: number; qcdAmount: number }[] = [];
  const qcdEligiblePersonIds =
    hasIndividualAccounts && rmdStartAgeByPerson.size > 0
      ? Array.from(rmdStartAgeByPerson.entries())
          .filter(
            ([, { birthYear }]) =>
              ageInYear(birthYear, year) >= QCD_MIN_ELIGIBILITY_AGE,
          )
          .map(([personId]) => personId)
      : [];
  if (qcdEligiblePersonIds.length > 0) {
    const iraTradByPerson = new Map<number, number>();
    for (const ia of indAccts) {
      if (
        isIraCategory(ia.category) &&
        ia.ownerPersonId != null &&
        isPreTaxType(ia.taxType) &&
        // R49: a Portfolio-parented IRA (nothing prevents one existing)
        // isn't retirement money -- must not inflate QCD-eligible capacity.
        !isPortfolioParent(ia.parentCategory)
      ) {
        const bal = indBal.get(indKey(ia)) ?? 0;
        iraTradByPerson.set(
          ia.ownerPersonId,
          (iraTradByPerson.get(ia.ownerPersonId) ?? 0) + bal,
        );
      }
    }
    qcdByPerson = computeQcdAmounts(
      config.qcdMaximize,
      qcdEligiblePersonIds.map((personId) => ({
        personId,
        iraTraditionalBalance: iraTradByPerson.get(personId) ?? 0,
      })),
    );
    totalQcd = totalQcdAmount(qcdByPerson);
    if (totalQcd > 0) {
      // Aggregate tracks (matches reinvestRmdExcess's own pattern -- both
      // trackers must still move together regardless of the per-account
      // debit below).
      balances.preTax = roundToCents(balances.preTax - totalQcd);
      addTraditional(acctBal.ira, -totalQcd);
      // R49: the aggregate deduction above is correctly SIZED (totalQcd
      // only ever reflects Retirement-parented IRA capacity, per the
      // filter above), but leaving the individual side to
      // reconcileIndividualToAggregate would spread it proportionally
      // across every IRA in the category -- a hypothetical
      // Portfolio-parented IRA included -- undoing the point of that
      // filter one step later. Debit each person's OWN qcdAmount from
      // only THAT person's own Retirement-parented IRA indBal entries
      // (proportional to each account's own balance): a QCD is legally a
      // transfer from one specific owner's IRA, so this must be per-person,
      // never pooled across the household.
      for (const { personId, qcdAmount } of qcdByPerson) {
        if (qcdAmount <= 0) continue;
        const personIraAccts = indAccts.filter(
          (ia) =>
            isIraCategory(ia.category) &&
            ia.ownerPersonId === personId &&
            isPreTaxType(ia.taxType) &&
            !isPortfolioParent(ia.parentCategory),
        );
        const personIraTotal = personIraAccts.reduce(
          (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
          0,
        );
        if (personIraTotal <= 0) continue;
        let distributed = 0;
        for (const ia of personIraAccts) {
          const k = indKey(ia);
          const bal = Math.max(0, indBal.get(k) ?? 0);
          const share = roundToCents(qcdAmount * (bal / personIraTotal));
          const capped = Math.min(share, bal);
          indBal.set(k, roundToCents(bal - capped));
          distributed += capped;
        }
        // Rounding remainder mop-up, same convention as elsewhere in this
        // file (e.g. Roth conversion's tradAccounts loop).
        const remainder = roundToCents(qcdAmount - distributed);
        if (remainder > 0.005 && personIraAccts.length > 0) {
          const first = personIraAccts[0]!;
          const k = indKey(first);
          const bal = Math.max(0, indBal.get(k) ?? 0);
          indBal.set(k, roundToCents(Math.max(0, bal - remainder)));
        }
      }
    }
  }

  // Tax gross-up: estimate tax from expected withdrawal routing, then
  // increase withdrawal so after-tax proceeds cover the expense need.
  const taxRates = decumulationDefaults.distributionTaxRates;
  const estTraditionalPortion =
    totalBalance > 0 ? balances.preTax / totalBalance : 0;

  // SS convergence + gross-up estimation (extracted to tax-gross-up module)
  const taxEst = estimateWithdrawalTaxCost({
    afterTaxNeed,
    ssIncome,
    filingStatus,
    config,
    taxRates,
    balances,
    acctBal,
    totalBalance,
    eligibility,
    nonRetirement,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBal: hasIndividualAccounts ? indBal : undefined,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    year,
  });
  let { taxableSS } = taxEst;
  let { grossUpFactor } = taxEst;
  const { targetWithdrawal } = taxEst;

  // Build per-account, per-tax-type balances for withdrawal routing
  // Uses real per-account balances tracked through accumulation
  const acctBalances = acctBal;
  const preWithdrawalAcctBal = cloneAccountBalances(acctBal);

  // Route withdrawals based on configured mode -- single dispatch point
  // shared with tax-gross-up.ts's estimate (routeForMode in
  // withdrawal-routing.ts), so a routing-mode-specific rule (like the Roth
  // bracket overlay below) can't diverge between the estimate and real
  // execution.
  // bracket_filling: tax-optimal -- fills traditional up to bracket cap, Roth for rest
  // waterfall: sequential drain in priority order (legacy behavior)
  // percentage: fixed % split across accounts
  //
  // For waterfall/percentage, Roth bracket optimization can still overlay
  // via rothBracketTarget (sets a traditional tax-type cap).
  // v0.7.9 R40 follow-up: cost-aware post-bracket-cap ranking inputs
  // (bracket_filling mode only; ignored by waterfall/percentage). See
  // deriveBasisRankingInputs's docblock for why the basis-derived fields
  // are shared with tax-gross-up.ts's estimate.
  //
  // magiBeforeThisDraw is intentionally OMITTED here (advisor review,
  // 2026-08-29 -- was previously magiHistory's prior-YEAR MAGI, a real
  // bug: NIIT's MAGI test has no lookback, unlike IRMAA's genuine 2-year
  // lookback that magiHistory exists for; RouteBracketInfo's own docblock
  // says "MAGI before THIS YEAR'S gains/growth," which prior-year data
  // never was). Omitting it lets withdrawal-routing.ts's own `??
  // baseOrdinaryFloor` fallback apply -- the correct current-year
  // pre-this-draw figure (taxableSS + totalTradWithdrawn +
  // conversionReservedRoom) -- which is also exactly what
  // tax-gross-up.ts's estimate already falls back to, so the two paths
  // can no longer disagree on this number.
  const { rothBasisAvailable, brokerageBasisRatio } = deriveBasisRankingInputs({
    balances,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
  });

  const routeResult = routeForMode(
    targetWithdrawal,
    config,
    acctBalances,
    {
      taxBrackets: taxRates.taxBrackets,
      // Added 2026-08-29: read the resolved (possibly per-year-overridden)
      // value first, falling back to the plan's fixed default — was
      // previously always the fixed default, with no override path at all.
      rothBracketTarget: config.rothBracketTarget ?? taxRates.rothBracketTarget,
      taxableSS,
      filingStatus,
      ltcgBrackets: taxRates.ltcgBrackets,
      rothBasisAvailable,
      brokerageBasisRatio,
      conversionsEnabled: taxRates.enableRothConversions,
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

  let totalWithdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  const totalRothWithdrawal = roundToCents(
    sumBy(slots, (s) => s.rothWithdrawal),
  );
  let totalTraditionalWithdrawal = roundToCents(
    sumBy(slots, (s) => s.traditionalWithdrawal),
  );

  // --- RMD enforcement (Phase 1) ---
  // perPersonRmdTotal/rmdByPerson computed earlier now (R46, see above --
  // QCD needed them before tax gross-up). The override passed here is
  // reduced by whatever QCD already satisfied directly, so enforceRmd only
  // tops up routing to cover the REMAINING (non-QCD) RMD requirement --
  // the QCD'd portion already left the account above, tax-free, and must
  // not also be forced through as a second, taxable distribution.
  const rmdRequiredAfterQcd =
    perPersonRmdTotal != null
      ? roundToCents(Math.max(0, perPersonRmdTotal - totalQcd))
      : undefined;

  // Extracted to rmd-enforcement.ts -- enforces minimum Traditional withdrawals per IRS rules.
  const rmdResult = enforceRmd({
    age,
    rmdStartAge,
    priorYearEndTradBalance,
    slots,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    acctBal,
    overrideRmdRequired: rmdRequiredAfterQcd,
    nonRetirement,
  });
  const { rmdOverrodeRouting, rmdShortfallAmount } = rmdResult;
  totalTraditionalWithdrawal = rmdResult.totalTraditionalWithdrawal;
  totalWithdrawal = rmdResult.totalWithdrawal;
  routeWarnings.push(...rmdResult.warnings);
  // The row's public rmdAmount must be the TRUE full RMD requirement, not
  // the QCD-reduced figure enforceRmd used internally to decide how much
  // MORE to force through routing -- otherwise a household with QCD
  // active would see an understated "your RMD this year" number. QCD
  // still counts toward satisfying the real RMD; it just doesn't route
  // through a taxable distribution to get there.
  const rmdAmount =
    perPersonRmdTotal != null ? perPersonRmdTotal : rmdResult.rmdAmount;

  // Recompute taxableSS with actual Traditional withdrawal (post-RMD) for final tax cost.
  // TODO(F2): If muni bond income tracking is added, pass taxExemptInterest as 4th arg.
  if (filingStatus && ssIncome > 0) {
    taxableSS = computeTaxableSS(
      ssIncome,
      totalTraditionalWithdrawal,
      filingStatus,
    );
  }

  // Distribute withdrawals to individual accounts -- extracted to individual-account-tracking.ts
  // Moved ABOVE computeTaxFromSlots (v0.7.8 Roth-tax-basis follow-up,
  // DESIGN-DECISION-v0.7.8-roth-tax-basis.md § Q3): tax computation needs
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
    ? distributeWithdrawals(slots, indAccts, indKey, indBal, eligibility)
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

  // Roth growth-vs-basis taxability (v0.7.8 Roth-tax-basis follow-up,
  // DESIGN-DECISION-v0.7.8-roth-tax-basis.md) -- consumes this year's
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

  // Early-withdrawal penalty cost (v0.7.8 penalty-hard-exclusion follow-up,
  // DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q5) -- consumes this
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

  // Calculate tax cost per withdrawal type -- single source of truth shared
  // with tax-gross-up.ts's estimate (Phase 5 item 5.3).
  const taxFromSlots = computeTaxFromSlots({
    slots,
    taxableSS,
    balances,
    taxRates,
    filingStatus,
    // Pass the authoritative post-RMD totals rather than letting this
    // re-derive from slots: rmd-enforcement.ts tracks
    // totalTraditionalWithdrawal incrementally (running += then
    // roundToCents), which isn't bit-for-bit identical to a fresh
    // roundToCents(sumBy(slots, ...)) over the same mutated slots.
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    rothTaxableGrowth: rothTaxSplit.taxableGrowth,
    penaltyCost: earlyWithdrawalPenalty.penaltyCost,
  });
  let brokerageTaxCost = taxFromSlots.brokerageTaxCost;
  const brokerageBasisPortion = taxFromSlots.brokerageBasisPortion;
  const brokerageGainsPortion = taxFromSlots.brokerageGainsPortion;
  const hsaWithdrawal = taxFromSlots.hsaWithdrawal;
  const actualTraditionalRate = taxFromSlots.actualTraditionalRate;
  // v0.7.8 advisor review (2026-08-27): this used to be re-derived locally
  // as `totalTraditionalWithdrawal + taxableSS`, silently dropping
  // non-qualified Roth growth income (rothTaxSplit.taxableGrowth) from
  // everything downstream (LTCG bracket selection, MAGI). Read the single
  // source of truth computeTaxFromSlots already computed instead.
  const actualTaxableIncome = taxFromSlots.actualTaxableIncome;
  // Annotate the brokerage slot with its basis/gains breakdown -- same gate
  // computeTaxFromSlots uses internally to decide whether there's a real
  // split to report (leaves the slot's basisPortion/gainsPortion undefined
  // otherwise, matching the original inline logic, rather than annotating
  // with 0/0).
  const brokerageSlot = slots.find((s) => isOverflowTarget(s.category));
  if (
    brokerageSlot &&
    taxFromSlots.brokerageWithdrawal > 0 &&
    balances.afterTax > 0
  ) {
    brokerageSlot.basisPortion = brokerageBasisPortion;
    brokerageSlot.gainsPortion = brokerageGainsPortion;
  }

  let taxCost = taxFromSlots.taxCost;
  const penaltyCost = taxFromSlots.penaltyCost;

  // Recompute grossUpFactor post-RMD for accurate diagnostics (#45).
  // Pre-RMD estimate may understate tax when RMD forces additional Traditional withdrawals.
  // Includes penaltyCost in the cost scalar alongside taxCost (v0.7.8
  // penalty-hard-exclusion follow-up § Q5) -- RMD dollars are never
  // penalty-exposed by construction (see this module's RMD-exempt note),
  // so RMD enforcement itself never changes penaltyCost, but this recompute
  // must still reflect whatever penaltyCost already was (nonzero only when
  // avoidPenalizedWithdrawals is off).
  if (rmdOverrodeRouting && afterTaxNeed > 0) {
    const postRmdTotalCost = roundToCents(taxCost + penaltyCost);
    const postRmdEffRate = postRmdTotalCost / (afterTaxNeed + postRmdTotalCost);
    // Not a safeDivide candidate (advisor-reviewed, 2026-08-19): the guard
    // is `< 1`, not a zero-denominator check — postRmdEffRate exceeding 1 is
    // a real, semantically distinct case (over-withheld/clawback) from it
    // being exactly 1, and safeDivide only special-cases denominator === 0.
    grossUpFactor =
      postRmdEffRate < 1 ? 1 / (1 - postRmdEffRate) : grossUpFactor;
  }

  // Deduct withdrawals from tax buckets and per-account balances -- extracted to balance-deduction.ts
  deductWithdrawals({ slots, balances, acctBal, brokerageBasisPortion });

  // Ensure no negative balances -- extracted to balance-deduction.ts
  clampBalances(balances, acctBal);

  // Apply decumulation lump sums (one-time injections/windfalls, NOT subject to limits)
  applyLumpSums(config.lumpSums, ctx, state);

  // Handle RMD-forced excess (#39, mode-aware R46) -- extracted to balance-deduction.ts
  const shouldHandleRmdExcess = input.reinvestRmdExcess !== false; // default: true
  // R46 Phase 1: capture the excess amount (previously discarded) so it can
  // be surfaced in the UI — this money is real, forced out of Traditional
  // by the RMD floor regardless of what the strategy needed, with no prior
  // UI trace. R46 Phase 2: what happens to it depends on the household's
  // rmdExcessHandling setting (reinvest into brokerage, or spend it).
  const rmdExcessAmount = reinvestRmdExcess(
    config.rmdExcessHandling,
    shouldHandleRmdExcess,
    rmdOverrodeRouting,
    totalWithdrawal,
    afterTaxNeed,
    taxCost,
    balances,
    acctBal,
    hasIndividualAccounts ? indAccts : undefined,
    hasIndividualAccounts ? indBal : undefined,
    hasIndividualAccounts ? indKey : undefined,
  );

  // Clamp individual account balances -- extracted to individual-account-tracking.ts
  if (hasIndividualAccounts) {
    clampIndividualBalances(indAccts, indKey, indBal);
  }

  // Track per-account depletions -- extracted to balance-deduction.ts
  trackDepletions(acctBal, depletionTracked, accountDepletions, year, age);

  // --- R47: RMD-aware Roth conversion smoothing ---
  // Computed fresh every year (adaptive, not a one-time plan) from each
  // person's CURRENT Traditional balance (post this year's withdrawal/
  // RMD/QCD, via indBal -- more accurate than the stale
  // priorYearEndTradByPerson snapshot). See rmd-smoothing.ts and
  // .scratch/docs/plans/PLAN-r47-rmd-aware-roth-smoothing.md. Requires
  // individual-account tracking -- entirely per-person by design, same
  // precondition R46/R49's per-person RMD/QCD already have.
  let rmdSmoothingTarget: number | undefined;
  if (
    config.rmdSmoothingEnabled &&
    hasIndividualAccounts &&
    rmdStartAgeByPerson.size > 0
  ) {
    const smoothingPeople = Array.from(rmdStartAgeByPerson.entries()).map(
      ([personId, { startAge, birthYear }]) => {
        const personTraditionalBalance = indAccts
          .filter(
            (ia) => ia.ownerPersonId === personId && isPreTaxType(ia.taxType),
          )
          .reduce((s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0), 0);
        return {
          personId,
          currentAge: ageInYear(birthYear, year),
          rmdStartAge: startAge,
          personTraditionalBalance,
        };
      },
    );
    const smoothingResult = computeRmdSmoothingTargets({
      enabled: true,
      people: smoothingPeople,
      householdTraditionalBalance: balances.preTax,
      returnRateMap: ctx.returnRateMap,
      totalTraditionalWithdrawal,
      totalWithdrawal,
      currentProjectedAnnualSpendingNeed: state.projectedExpenses,
      postRetirementInflationRate: ctx.validatedPostRetirementInflation,
    });
    if (smoothingResult.householdSmoothingTarget > 0) {
      rmdSmoothingTarget = smoothingResult.householdSmoothingTarget;
    }
  }

  // --- Roth Conversions (Phase 4) ---
  // Extracted to post-withdrawal-optimizer.ts -- Roth conversion + IRMAA + ACA chain.
  const rothResult = performRothConversion({
    enableRothConversions: taxRates.enableRothConversions,
    taxBrackets: taxRates.taxBrackets,
    taxMultiplier: taxRates.taxMultiplier,
    rothConversionTarget: config.rothConversionTarget,
    // Fixed 2026-08-29, corrected after real test failures caught an
    // over-eager first attempt: the ORIGINAL expression was
    // `taxRates.rothConversionTarget ?? taxRates.rothBracketTarget` --
    // this reads two *unresolved* plan-level defaults, which is exactly
    // right when nothing has overridden either one (this parameter is
    // itself only ever consulted as performRothConversion's fallback,
    // reached precisely when config.rothConversionTarget is already
    // undefined -- so re-deriving from the same resolved field here would
    // be redundant, not "more correct"). The real gap was that a NEW
    // per-year rothBracketTarget override (this session's addition) had
    // no way to take priority over those two static defaults. Fixed by
    // adding config.rothBracketTarget as a higher-priority first term,
    // WITHOUT removing the original two-default fallback chain --
    // dropping taxRates.rothConversionTarget (an earlier attempt at this
    // fix did) broke every household relying on a plan-level
    // rothConversionTarget default with no per-year override active,
    // exactly what fixtures 31/41/54/55/61 and the Bug-B MAGI test cover.
    rothBracketTarget:
      config.rothBracketTarget ??
      taxRates.rothConversionTarget ??
      taxRates.rothBracketTarget,
    totalTraditionalWithdrawal,
    taxableSS,
    brokerageGainsPortion,
    irmaaAwareRothConversions:
      input.irmaaAwareRothConversions ??
      (enableIrmaaAwareness ? true : undefined),
    filingStatus,
    balances,
    acctBal,
    // R49 — advisor round 4: without this, performRothConversion's own
    // fixes above are fully implemented and fully unit-tested but never
    // execute in production, since "params omitted" is deliberately the
    // unchanged-behavior fallback.
    nonRetirement,
    indAccts: hasIndividualAccounts ? indAccts : undefined,
    indBal: hasIndividualAccounts ? indBal : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget: config.rmdSmoothingMaxBracketTarget,
  });
  const { rothConversionAmount, rothConversionTaxCost, rmdSmoothingShortfall } =
    rothResult;

  // Recompute LTCG tax including Roth conversion income (#37).
  // Roth conversions are taxed as ordinary income and push total taxable income
  // into potentially higher LTCG brackets (0%/15%/20%).
  let postConversionLtcgRate: number;
  const revisedOrdinary = actualTaxableIncome + rothConversionAmount;
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    brokerageTaxCost = roundToCents(
      computeLtcgTax(
        revisedOrdinary,
        brokerageGainsPortion,
        filingStatus,
        taxRates.ltcgBrackets,
      ),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      revisedOrdinary + brokerageGainsPortion,
      filingStatus,
      taxRates.ltcgBrackets,
    );
    // Recompute taxCost with revised brokerage tax. v0.7.8 advisor review
    // (2026-08-27): this used to tax the WHOLE Roth withdrawal at
    // taxRates.roth (0 by default) — the pre-Roth-tax-basis formula,
    // silently un-updated when that feature split Roth withdrawals into a
    // taxable-growth portion (taxed at actualTraditionalRate, same as
    // computeTaxFromSlots's own formula) and a tax-free portion. In a
    // conversion year with brokerage gains AND a non-qualified Roth
    // growth draw, tax on that growth vanished entirely. Mirrors
    // computeTaxFromSlots's own taxCost formula exactly, just with the
    // revised brokerageTaxCost substituted in.
    taxCost = roundToCents(
      totalTraditionalWithdrawal * actualTraditionalRate +
        taxFromSlots.rothTaxableGrowth * actualTraditionalRate +
        taxFromSlots.rothTaxFreePortion * taxRates.roth +
        hsaWithdrawal * taxRates.hsa +
        brokerageTaxCost,
    );
  } else {
    // Display-only: marginal bracket at the ceiling of the gains stack.
    // No tax is actually computed from this value.
    postConversionLtcgRate =
      brokerageGainsPortion > 0 && filingStatus
        ? getLtcgRate(
            revisedOrdinary + brokerageGainsPortion,
            filingStatus,
            taxRates.ltcgBrackets,
          )
        : brokerageGainsPortion > 0
          ? taxRates.brokerage
          : filingStatus
            ? getLtcgRate(revisedOrdinary, filingStatus, taxRates.ltcgBrackets)
            : taxRates.brokerage;
  }

  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  // Applies to lesser of net investment income or MAGI exceeding threshold.
  // Roth conversions raise MAGI but are NOT net investment income.
  // v0.7.8 advisor review (2026-08-27): non-qualified Roth growth income
  // (taxFromSlots.rothTaxableGrowth) was missing here too, understating
  // MAGI fed into NIIT, the 2-year IRMAA lookback, and the ACA subsidy
  // check below — same root cause as the taxCost recompute fix above.
  const currentYearMagi =
    totalTraditionalWithdrawal +
    taxFromSlots.rothTaxableGrowth +
    rothConversionAmount +
    brokerageGainsPortion +
    taxableSS;
  const niitAmount = filingStatus
    ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
    : 0;
  if (niitAmount > 0) {
    taxCost = roundToCents(taxCost + niitAmount);
  }

  // Funding-shortfall reconciliation (advisor review, 2026-08-26, alongside
  // the tax-gross-up.ts secant-convergence fix). routedUnmetNeed only fires
  // when the ROUTER itself couldn't deliver the requested targetWithdrawal
  // (account caps, exclusion, genuine balance exhaustion) -- it structurally
  // cannot catch a funding gap caused by the gross-up under-sizing
  // targetWithdrawal in the first place, or by taxCost/penaltyCost growing
  // AFTER routing (RMD enforcement, Roth conversions, brokerage LTCG
  // recompute, NIIT -- all of which run after routeForMode and are accepted,
  // documented residual-gap sources per this file's RMD/Roth-conversion
  // notes, not fixable pre-routing). Comparing what was actually delivered
  // against what was actually needed catches ALL of those sources in one
  // place, not just the router's own. `unmetNeed` for the CURRENT year's
  // output is the max of the two signals -- never double-counted, since
  // they measure the same failure from different vantage points and a real
  // shortfall should show up in at least one.
  const deliveredAfterTax = roundToCents(
    totalWithdrawal - taxCost - penaltyCost,
  );
  const fundingShortfall = roundToCents(
    Math.max(0, afterTaxNeed - deliveredAfterTax),
  );
  // Materiality floor, not a correctness tolerance (advisor review,
  // 2026-08-27): NIIT and the conversion-year LTCG recompute both run
  // AFTER routing and are accepted, documented residual-gap sources (the
  // gross-up estimate can't have grossed up for a cost that didn't exist
  // yet when it ran) -- a $0.01 floor here flagged UNMET NEED on every
  // ordinary NIIT year in an otherwise fully-solvent plan, drowning out
  // the signal a REAL shortfall (balance exhaustion, hard-exclusion) is
  // for. The greater of $50 or 1% of the need itself scales with plan
  // size while still catching genuine shortfalls, which tend to be a
  // large fraction of afterTaxNeed, not a rounding-scale sliver of it.
  const shortfallMaterialityFloor = Math.max(50, afterTaxNeed * 0.01);
  const finalUnmetNeed =
    fundingShortfall > shortfallMaterialityFloor
      ? Math.max(routedUnmetNeed ?? 0, fundingShortfall)
      : routedUnmetNeed;
  // Single canonical "is this a REAL shortfall worth alerting on" verdict
  // (advisor review, 2026-08-28) -- `finalUnmetNeed` above intentionally
  // preserves its existing byte-identical value/undefined-ness for
  // existing consumers (no cache-version bump needed for an additive
  // field), but its own two branches apply the materiality floor
  // inconsistently: the `routedUnmetNeed` fallback branch is NEVER
  // floor-filtered, so a rounding-scale routed residual could read as
  // `unmetNeed > 0` without being material. Chart/table/KPI alerting
  // should all key off THIS field, not re-derive materiality themselves
  // (three independent re-derivations is how a chart marker and a table
  // line end up disagreeing about the same year).
  //
  // grossUpForTaxes:false households net out the tax+penalty portion of
  // fundingShortfall before checking materiality (live-user finding,
  // 2026-08-28): with that setting off, the household has deliberately
  // chosen to withdraw the raw need and let tax/penalty come out of it
  // uncompensated -- fundingShortfall then equals ~taxCost+penaltyCost
  // EVERY single year, by design, forever. That's not a real/unexpected
  // shortfall the way a router failure or RMD-forced gap is; alerting on
  // it every year for the life of the plan would drown out the genuine
  // signal. routedUnmetNeed is untouched by this netting -- it's a
  // separate, always-real "the router couldn't reach the money" signal,
  // unrelated to the gross-up policy choice.
  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  const grossUpExplainedGap = shouldGrossUp
    ? 0
    : roundToCents(Math.min(taxCost + penaltyCost, fundingShortfall));
  const netFundingShortfall = Math.max(
    0,
    roundToCents(fundingShortfall - grossUpExplainedGap),
  );
  const unmetNeedMaterial =
    Math.max(routedUnmetNeed ?? 0, netFundingShortfall) >
    shortfallMaterialityFloor;

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
  // Under-65 is the ACA marketplace-subsidy eligibility criterion this
  // checks — it's the same real-world Medicare-eligibility event the IRMAA
  // block above tests, not an independent regulatory threshold, so it
  // shares MEDICARE_START_AGE (advisor-approved 2026-08-19).
  const allPersonsUnder65 =
    perPersonBirthYears && perPersonBirthYears.length > 0
      ? perPersonBirthYears.every((by) => year - by < MEDICARE_START_AGE)
      : age < MEDICARE_START_AGE;
  const acaResult = checkAca({
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize: householdSize ?? 2,
    totalTraditionalWithdrawal,
    rothConversionAmount,
    brokerageGainsPortion,
    ssIncome,
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
    const rampAccts = indAccts.filter((ia) => isOverflowTarget(ia.category));
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

  // Tracked Roth basis (v0.7.8 follow-up): clamp to this year's balance
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
          },
          eligibility,
        )
      : [];

  // Zero out rounding dust -- extracted to balance-deduction.ts
  cleanupDust(balances, acctBal, indAccts, indKey, indBal);

  // Reconcile indBal to acctBal once per year (v0.7.8 follow-up,
  // DESIGN-DECISION-v0.7.8-indbal-reconciliation.md) -- the two tracks are
  // "known to drift" (see withdrawal-eligibility.ts's module docblock, Q3
  // of the original Group 0 design); left unreconciled, next year's
  // eligibility gate can see a nonzero "eligible" balance for a category
  // that's actually 100% locked. Runs AFTER cleanupDust so it reads final
  // aggregate state for the year, and BEFORE the basis re-clamp below so
  // tracked basis clamps to the reconciled (not pre-reconciliation) balance.
  if (hasIndividualAccounts) {
    routeWarnings.push(
      ...reconcileIndividualToAggregate(indAccts, indKey, indBal, acctBal),
    );
  }

  // Re-clamp basis after dust cleanup -- a balance dust-cleaned to exactly
  // $0 must carry $0 basis into next year's state, even though this
  // year's already-built output row reflects the pre-dust-cleanup figure
  // (the dust amount is by definition negligible).
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccts, indKey, indBasis, indBal);
  }
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
    effectiveTaxRate: totalWithdrawal > 0 ? taxCost / totalWithdrawal : 0,
    ssIncome,
    ssIncomeByPerson,
    afterTaxNeed,
    grossUpFactor,
    estTraditionalPortion,
    bracketTraditionalCap: routeResult.traditionalCap,
    unmetNeed: finalUnmetNeed,
    unmetNeedMaterial,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
    penaltyCost,
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
    rmdShortfallAmount,
    rmdExcessAmount,
    rmdSmoothingShortfall,
    qcdAmount: totalQcd,
    qcdByPerson: qcdByPerson.length > 0 ? qcdByPerson : undefined,
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
