/**
 * runDecumulationYear — single-year decumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 */
import { socialSecurityForYear } from "../social-security-income";
import {
  followDraws,
  followInflows,
  followReconciliation,
  retirementBrokerageBasisRatio,
  syncAggregateBasis,
} from "../brokerage-basis";
import type { EngineDecumulationYear } from "../types/projection-result";
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { roundToCents, sumBy } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import {
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
  isPreTaxType,
  isQcdEligible,
  nonMedicalPenaltyRate,
} from "../../../config/account-types";
import { addTraditional } from "../../../config/account-balance";
import { computeQcdAmounts, totalQcdAmount } from "../qcd";
import { computeRmdSmoothingTargets } from "../rmd-smoothing";
import { computeObbbaSeniorDeduction } from "@/lib/pure/tax/return-deductions";
import {
  MAX_BROKERAGE_RAMP_YEARS,
  ADDITIONAL_STANDARD_DEDUCTION_AGE,
} from "../../../constants";
import { shortfallFloor } from "../gap-year-draw";
import { countReachingAgeRule, reachesAgeRule } from "@/lib/pure/household/age";
import { cloneAccountBalances, scopedBalances } from "../balance-utils";
import {
  getLtcgRate,
  computeLtcgTax,
  toLtcgTaxableIncome,
} from "@/lib/pure/tax/ltcg";
import { computeNiit } from "../../../config/niit";
import {
  growAmount,
  growWithholdingBrackets,
  growLtcgBrackets,
  growIrmaaBrackets,
  taxTableYears,
} from "../bracket-growth";
import { resolveDecumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import { computeTaxFromSlots, taxableSSFor } from "../tax-estimation";
import { estimateWithdrawalTaxCost } from "../withdrawal-solver";
import { routeForMode } from "../withdrawal-routing";
import { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import { enforceOwnerRmds, enforceRmd, rmdOwnerOf } from "../rmd-enforcement";
import { performRothConversion, checkAca } from "../post-withdrawal-optimizer";
import { checkHouseholdIrmaa } from "../household-irmaa";
import {
  distributeWithdrawals,
  applyIndividualGrowth,
  buildIndividualYearBalances,
  clampIndividualBalances,
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
import {
  deductWithdrawals,
  clampBalances,
  reinvestRmdExcess,
  trackDepletions,
  cleanupDust,
} from "../balance-deduction";
import { computeRmdAmount, getRmdFactor } from "../../../config/rmd-tables";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { updatePerPersonTradBalance } from "./helpers";
import { applyLumpSums } from "./lump-sum";
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";

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
  // The year's after-tax need: spending less Social Security — or, when
  // the strategy sized the gross withdrawal (Social Security on top), what
  // that withdrawal delivers after tax (set from the estimate below).
  let afterTaxNeed = roundToCents(
    Math.max(0, state.projectedExpenses - ssIncome),
  );
  // Social Security beyond spending pays the year's tax first — only the
  // rest needs a withdrawal (withdrawal-solver.ts solves with the same credit).
  // A withdrawal-sized year has Social Security on top by definition.
  let ssSurplus =
    state.portfolioWithdrawal === null
      ? Math.max(0, ssIncome - state.projectedExpenses)
      : 0;

  // --- Per-person RMD (moved ahead of routing/tax gross-up) ---
  // Compute each person's RMD from their own Traditional balance and age.
  // Previously computed AFTER routing (only needed for enforceRmd's
  // override), but the QCD step needs the RMD amount BEFORE tax
  // gross-up runs -- a QCD reduces taxable income for the year, so it has
  // to be known (and deducted) before estimateWithdrawalTaxCost, not
  // after. Pure computation, no dependency on routing -- safe to hoist.
  // Multi-person households with tracked accounts enforce each owner's RMD
  // on that owner's accounts, whether or not one is due this year; the
  // household calculation (primary's age on the pooled balance) is for
  // single-person households only.
  const perOwnerRmd = hasIndividualAccounts && rmdStartAgeByPerson.size > 0;
  let perPersonRmdTotal: number | undefined;
  let rmdByPerson:
    | {
        personId: number;
        personName: string;
        amount: number;
        divisor?: number;
        priorYearEndTradBalance?: number;
        age?: number;
        shortfall?: number;
      }[]
    | undefined;
  if (perOwnerRmd) {
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
                ?.personName ??
              ctx.indAccts.find((a) => a.ownerPersonId === personId)
                ?.ownerName ??
              "Account owner",
            amount: rmdAmount,
            // "Why is my RMD this amount" — the IRS Uniform Lifetime Table
            // divisor and the prior-year-end Traditional balance it's
            // divided by, both already computed just above (computeRmdAmount
            // itself calls getRmdFactor internally) — surfaced here rather
            // than re-derived by the UI, so the displayed math can't drift
            // from what actually produced `amount`.
            divisor: getRmdFactor(personAge) ?? undefined,
            priorYearEndTradBalance: personTrad,
            age: personAge,
          });
          total += rmdAmount;
        }
      }
    }
    if (total > 0) perPersonRmdTotal = roundToCents(total);
  }

  // --- Qualified Charitable Distribution ---
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
  // Eligibility is AGE_RULES.qcd (70), NOT rmdByPerson's
  // RMD-start-age gate -- QCD eligibility
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
          .filter(([, { birthYear }]) => reachesAgeRule(birthYear, "qcd", year))
          .map(([personId]) => personId)
      : [];
  if (qcdEligiblePersonIds.length > 0) {
    const iraTradByPerson = new Map<number, number>();
    for (const ia of indAccts) {
      if (
        isQcdEligible(ia.category) &&
        rmdOwnerOf(ia, ctx.primaryPersonId) != null &&
        isPreTaxType(ia.taxType) &&
        // A Portfolio-parented IRA (nothing prevents one existing)
        // isn't retirement money -- must not inflate QCD-eligible capacity.
        isRetirementMoney(ia.parentCategory)
      ) {
        const bal = indBal.get(indKey(ia)) ?? 0;
        const owner = rmdOwnerOf(ia, ctx.primaryPersonId)!;
        iraTradByPerson.set(owner, (iraTradByPerson.get(owner) ?? 0) + bal);
      }
    }
    // The per-person QCD limit is CPI-indexed (IRC 408(d)(8)(G)): grown
    // from the limits year like the standard deduction.
    const { qcdAnnualLimit, taxDataYear } =
      decumulationDefaults.distributionTaxRates;
    qcdByPerson = computeQcdAmounts(
      config.qcdMaximize,
      qcdEligiblePersonIds.map((personId) => ({
        personId,
        iraTraditionalBalance: iraTradByPerson.get(personId) ?? 0,
      })),
      qcdAnnualLimit * ctx.inflation.growthSinceVintage(year, taxDataYear),
    );
    totalQcd = totalQcdAmount(qcdByPerson);
    if (totalQcd > 0) {
      // Aggregate tracks (matches reinvestRmdExcess's own pattern -- both
      // trackers must still move together regardless of the per-account
      // debit below).
      balances.preTax = roundToCents(balances.preTax - totalQcd);
      addTraditional(acctBal.ira, -totalQcd);
      // The aggregate deduction above is correctly SIZED (totalQcd
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
            isQcdEligible(ia.category) &&
            rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
            isPreTaxType(ia.taxType) &&
            isRetirementMoney(ia.parentCategory),
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
  // Fold the IRC §63(f)(1) age-65+ additional standard deduction into
  // the base deduction BEFORE growth, so the senior amount is grown on the
  // same tax-data vintage as the base (both are CPI-indexed). `seniorCount`
  // is the number of household members who are 65+ in THIS projection year —
  // for a real decumulation-phase household that's almost every year, which
  // is exactly why omitting this systematically understated 0%-LTCG room.
  // The `perPersonBirthYears`-absent fallback (single senior when the
  // household representative age is 65+) mirrors the Medicare-age filter's
  // own fallback further below. Applied only when a base deduction exists —
  // `undefined` must keep meaning "subtract 0" for the LTCG path, and
  // `undefined + n*x` would be NaN.
  const seniorCount =
    perPersonBirthYears && perPersonBirthYears.length > 0
      ? perPersonBirthYears.filter(
          (by) => year - by >= ADDITIONAL_STANDARD_DEDUCTION_AGE,
        ).length
      : age >= ADDITIONAL_STANDARD_DEDUCTION_AGE
        ? 1
        : 0;
  const seniorStandardDeductionAddon =
    taxRates.standardDeduction != null &&
    taxRates.additionalStdDeduction65PerSenior
      ? seniorCount * taxRates.additionalStdDeduction65PerSenior
      : 0;
  // OBBBA temporary senior deduction (2025-2028) — same injection point as
  // §63(f) above (folded in BEFORE routing/tax estimation runs; see
  // return-deductions.ts's docblock for why it can't be applied later).
  // Phaseout basis: LAST YEAR's MAGI (incomeHistory has no `year` entry yet),
  // the 1-year lag IRMAA's lookback also uses. Decumulation year 1 has none:
  // the MAGI is unknown ⇒ $0 that year only, by design.
  const lastYearIncome = incomeHistory.at(-1);
  const obbbaAddon = computeObbbaSeniorDeduction({
    seniorCount,
    magi: lastYearIncome
      ? { kind: "known", value: yearMagi(lastYearIncome, "seniorDeduction") }
      : { kind: "unknown" },
    perPerson: taxRates.obbbaSeniorDeductionPerPerson,
    phaseoutStart: taxRates.obbbaSeniorPhaseoutStart,
    phaseoutRate: taxRates.obbbaSeniorPhaseoutRate,
    year,
    sunsetYear: taxRates.obbbaSeniorSunsetYear,
  });
  // obbbaAddon is NOT grown with the rest — it's a fixed, non-indexed
  // statutory dollar amount ($6,000/senior, phased out and sunset by
  // computeObbbaSeniorDeduction itself for the CURRENT `year`), unlike the
  // base standard deduction and §63(f) addon above, which are the
  // CPI-indexed amounts `taxGrowth` exists to project forward. Folding it
  // into the pre-growth sum inflated the fixed $6,000 by 1-2 years of CPI
  // for any projection year past the tax-data vintage — added back in
  // after growth instead.
  const grownBaseAndSeniorDeduction = growAmount(
    taxRates.standardDeduction != null
      ? taxRates.standardDeduction + seniorStandardDeductionAddon
      : taxRates.standardDeduction,
    taxGrowth,
  );
  const grownStandardDeduction =
    grownBaseAndSeniorDeduction != null
      ? grownBaseAndSeniorDeduction + obbbaAddon
      : grownBaseAndSeniorDeduction;
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
  // IRMAA paid on top of the budget joins a need-sized year's need, so the
  // gross-up, shortfall and RMD excess all see it. It's a cost beside the
  // need: never in projectedExpenses (a strategy would carry it forward)
  // and never in taxCost (the optimizer already adds irmaaCost to it). The
  // year-N-2 MAGI is known here. The first two decumulation years have no
  // lookback yet and fall back to this year's MAGI, which isn't known until
  // the year is routed, so there the surcharge only lowers what's spent; a
  // withdrawal-sized year's withdrawal stays the strategy's amount, likewise.
  if (
    input.irmaaOnTopOfBudget === true &&
    state.portfolioWithdrawal === null &&
    incomeHistory.length >= 2
  ) {
    const irmaaInNeed = checkHouseholdIrmaa({
      enableIrmaaAwareness,
      filingStatus,
      personsAge65Plus,
      projectedMagi: yearMagi(incomeHistory.at(-2)!, "irmaa"),
      rothConversionAmount: 0,
      irmaaBrackets: grownIrmaaBracketsForCheck,
    }).irmaaCost;
    afterTaxNeed = roundToCents(
      Math.max(0, state.projectedExpenses + irmaaInNeed - ssIncome),
    );
    ssSurplus = Math.max(0, ssIncome - state.projectedExpenses - irmaaInNeed);
  }

  // SS convergence + gross-up estimation (extracted to withdrawal-solver module)
  const taxEst = estimateWithdrawalTaxCost({
    afterTaxNeed,
    fixedGrossWithdrawal: state.portfolioWithdrawal ?? undefined,
    ssIncome,
    ssSurplus,
    filingStatus,
    config,
    // Grown ordinary tax brackets/standard deduction/LTCG brackets
    // spliced in — the estimate and the real routing/tax calls below
    // MUST see the identical grown values, same single-dispatch
    // invariant as every other field on this object (this file's own
    // header docblock).
    taxRates: {
      ...taxRates,
      taxBrackets: grownTaxBrackets,
      standardDeduction: grownStandardDeduction,
      ltcgBrackets: grownLtcgBrackets,
    },
    balances,
    acctBal,
    totalBalance,
    brokerageBasisRatio: retirementBasisRatio,
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
  if (taxEst.derivedAfterTaxNeed !== undefined)
    afterTaxNeed = taxEst.derivedAfterTaxNeed;

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
      taxableSS,
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

  let totalWithdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  const totalRothWithdrawal = roundToCents(
    sumBy(slots, (s) => s.rothWithdrawal),
  );
  let totalTraditionalWithdrawal = roundToCents(
    sumBy(slots, (s) => s.traditionalWithdrawal),
  );

  // --- RMD enforcement (Phase 1) ---
  // perPersonRmdTotal/rmdByPerson computed earlier now (see above --
  // QCD needed them before tax gross-up). Each person's requirement is
  // reduced by that person's own QCD -- one person's QCD above their own
  // RMD never reduces another's -- so only the REMAINING (non-QCD) RMD is
  // enforced: the QCD'd portion already left the account above, tax-free,
  // and must not also be forced through as a second, taxable distribution.

  // Household-level "why is my RMD this amount" fallback — same
  // getRmdFactor/priorYearEndTradBalance enforceRmd's own internal
  // computeRmdAmount call uses when no per-person override is supplied
  // (the household path below), surfaced here rather than
  // re-derived by the UI. Only meaningful when rmdByPerson isn't
  // populated (single-person households / no per-person RMD tracking) —
  // the per-person breakdown above always wins when both exist.
  const rmdDivisor =
    !perOwnerRmd &&
    rmdStartAge != null &&
    age >= rmdStartAge &&
    priorYearEndTradBalance > 0
      ? (getRmdFactor(age) ?? undefined)
      : undefined;

  // Extracted to rmd-enforcement.ts -- enforces minimum Traditional withdrawals per IRS rules.
  const ownerRmd = perOwnerRmd
    ? enforceOwnerRmds({
        owners: (rmdByPerson ?? []).map(({ personId, personName, amount }) => ({
          personId,
          personName,
          required: roundToCents(
            Math.max(
              0,
              amount -
                (qcdByPerson.find((q) => q.personId === personId)?.qcdAmount ??
                  0),
            ),
          ),
        })),
        primaryPersonId: ctx.primaryPersonId,
        slots,
        totalTraditionalWithdrawal,
        totalWithdrawal,
        acctBal,
        indAccts,
        indKey,
        indBal,
        nonRetirement,
      })
    : null;
  const rmdResult =
    ownerRmd ??
    enforceRmd({
      age,
      rmdStartAge,
      priorYearEndTradBalance,
      slots,
      totalTraditionalWithdrawal,
      totalWithdrawal,
      acctBal,
      nonRetirement,
    });
  const { rmdOverrodeRouting, rmdShortfallAmount } = rmdResult;
  totalTraditionalWithdrawal = rmdResult.totalTraditionalWithdrawal;
  totalWithdrawal = rmdResult.totalWithdrawal;
  routeWarnings.push(...rmdResult.warnings);
  if (ownerRmd && rmdByPerson) {
    rmdByPerson = rmdByPerson.map((p) => {
      const shortfall = ownerRmd.shortfallByPerson.get(p.personId);
      return shortfall ? { ...p, shortfall } : p;
    });
    if (
      !state.rmdNoOwnerWarned &&
      rmdByPerson.some((p) => p.personId === ctx.primaryPersonId) &&
      indAccts.some(
        (ia) => ia.ownerPersonId == null && isPreTaxType(ia.taxType),
      )
    ) {
      state.rmdNoOwnerWarned = true;
      routeWarnings.push(
        "A Traditional account has no owner — its RMD is counted with the primary person's. Give it an owner so the RMD falls on the right person.",
      );
    }
  }
  // The row's public rmdAmount must be the TRUE full RMD requirement, not
  // the QCD-reduced figure enforceRmd used internally to decide how much
  // MORE to force through routing -- otherwise a household with QCD
  // active would see an understated "your RMD this year" number. QCD
  // still counts toward satisfying the real RMD; it just doesn't route
  // through a taxable distribution to get there.
  const rmdAmount = ownerRmd
    ? (perPersonRmdTotal ?? 0)
    : "rmdAmount" in rmdResult
      ? rmdResult.rmdAmount
      : 0;

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

  // Calculate tax cost per withdrawal type -- single source of truth shared
  // with withdrawal-solver.ts's estimate. One pricing call, used again for the
  // post-conversion recompute below (never a hand copy of its formula).
  const priceTax = (ss: number, brokerageTaxCostOverride?: number) =>
    computeTaxFromSlots({
      slots,
      taxableSS: ss,
      balances,
      taxRates: {
        ...taxRates,
        taxBrackets: grownTaxBrackets,
        standardDeduction: grownStandardDeduction,
        ltcgBrackets: grownLtcgBrackets,
      },
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
      brokerageBasisRatio,
      brokerageTaxCostOverride,
    });
  // Social Security's taxable share from this year's actual (post-RMD)
  // income — Traditional, non-qualified Roth growth and brokerage gains
  // (taxableSSFor) — then the year priced with it. The first pass only
  // supplies those amounts, which don't depend on taxable SS.
  // TODO: If muni bond income tracking is added, pass taxExemptInterest.
  let taxFromSlots = priceTax(taxableSS);
  if (filingStatus && ssIncome > 0) {
    taxableSS = taxableSSFor(ssIncome, taxFromSlots, filingStatus);
    taxFromSlots = priceTax(taxableSS);
  }
  let brokerageTaxCost = taxFromSlots.brokerageTaxCost;
  const brokerageBasisPortion = taxFromSlots.brokerageBasisPortion;
  const brokerageGainsPortion = taxFromSlots.brokerageGainsPortion;
  // This used to be re-derived locally
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
  const ssTaxCost = taxFromSlots.ssTaxCost;
  // Never more than the tax: the surplus isn't banked.
  const surplusCredit = (tax: number) =>
    roundToCents(Math.min(ssSurplus, Math.max(0, tax)));

  // Recompute grossUpFactor post-RMD for accurate diagnostics (#45).
  // Pre-RMD estimate may understate tax when RMD forces additional Traditional withdrawals.
  // Includes penaltyCost in the cost scalar alongside taxCost -- RMD dollars are never
  // penalty-exposed by construction (see this module's RMD-exempt note),
  // so RMD enforcement itself never changes penaltyCost, but this recompute
  // must still reflect whatever penaltyCost already was (nonzero only when
  // avoidPenalizedWithdrawals is off).
  // (Nothing is grossed up when the strategy fixed the gross withdrawal.)
  if (
    rmdOverrodeRouting &&
    afterTaxNeed > 0 &&
    state.portfolioWithdrawal === null
  ) {
    const postRmdTotalCost = roundToCents(taxCost + penaltyCost);
    const postRmdEffRate = postRmdTotalCost / (afterTaxNeed + postRmdTotalCost);
    // Not a safeDivide candidate: the guard
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
  // Lump sums are cash in: new basis in the brokerage account they land in.
  followInflows(indAccts, indKey, indBal, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  // Handle RMD-forced excess (mode-aware) -- extracted to balance-deduction.ts
  // Capture the excess amount (previously discarded) so it can
  // be surfaced in the UI — this money is real, forced out of Traditional
  // by the RMD floor regardless of what the strategy needed, with no prior
  // UI trace. What happens to it depends on the household's
  // rmdExcessHandling setting (reinvest into brokerage, or spend it).
  // Reinvested RMD money is cash in: new basis where it lands.
  const rmdExcessAmount = followInflows(
    indAccts,
    indKey,
    indBal,
    brokBasis,
    () =>
      reinvestRmdExcess(
        config.rmdExcessHandling,
        rmdOverrodeRouting,
        totalWithdrawal,
        afterTaxNeed,
        // The tax the withdrawal pays — Social Security's surplus pays the rest.
        roundToCents(taxCost - surplusCredit(taxCost)),
        balances,
        acctBal,
        hasIndividualAccounts ? indAccts : undefined,
        hasIndividualAccounts ? indBal : undefined,
        hasIndividualAccounts ? indKey : undefined,
      ),
  );

  // Clamp individual account balances -- extracted to individual-account-tracking.ts
  if (hasIndividualAccounts) {
    followDraws(indAccts, indKey, indBal, brokBasis, () =>
      clampIndividualBalances(indAccts, indKey, indBal),
    );
  }

  // Track per-account depletions -- extracted to balance-deduction.ts
  trackDepletions(acctBal, depletionTracked, accountDepletions, year, age);

  // --- RMD-aware Roth conversion smoothing ---
  // Computed fresh every year (adaptive, not a one-time plan) from each
  // person's CURRENT Traditional balance (post this year's withdrawal/
  // RMD/QCD, via indBal -- more accurate than the stale
  // priorYearEndTradByPerson snapshot). See rmd-smoothing.ts. Requires
  // individual-account tracking -- entirely per-person by design, same
  // precondition the per-person RMD/QCD path already has.
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
            (ia) =>
              rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
              isPreTaxType(ia.taxType),
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
      // What leaves the portfolio this year — not spending, which Social
      // Security partly covers (and which a portfolio-sized strategy with
      // Social Security on top doesn't size at all).
      currentProjectedAnnualSpendingNeed: targetWithdrawal,
      postRetirementInflationRate: ctx.validatedPostRetirementInflation,
    });
    if (smoothingResult.householdSmoothingTarget > 0) {
      rmdSmoothingTarget = smoothingResult.householdSmoothingTarget;
    }
  }

  // --- Roth Conversions (Phase 4) ---
  // Extracted to post-withdrawal-optimizer.ts -- Roth conversion + IRMAA + ACA chain.
  // The conversion's tax is paid from retirement brokerage money (money
  // out: basis leaves at the account's own ratio).
  const rothResult = followDraws(indAccts, indKey, indBal, brokBasis, () =>
    performRothConversion({
      // The conversion's tax comes out of retirement brokerage money.
      brokerageBasisRatio: hasIndividualAccounts
        ? retirementBrokerageBasisRatio(indAccts, indKey, indBal, brokBasis)
        : undefined,
      enableRothConversions: taxRates.enableRothConversions,
      taxBrackets: grownTaxBrackets,
      taxMultiplier: taxRates.taxMultiplier,
      standardDeduction: grownStandardDeduction,
      rothConversionTarget: config.rothConversionTarget,
      // This param is performRothConversion's fallback, consulted ONLY when
      // config.rothConversionTarget (above) is undefined. Priority (most to
      // least specific):
      //   1. taxRates.rothConversionTarget -- an explicit plan-level
      //      conversion target the household set deliberately, separate
      //      from (and possibly more conservative than) their withdrawal
      //      bracket target.
      //   2. config.rothBracketTarget -- a per-year WITHDRAWAL-routing
      //      override. An earlier version put
      //      this FIRST, ahead of taxRates.rothConversionTarget -- a
      //      household with an explicit plan-level rothConversionTarget
      //      (say 12%, deliberately below their rothBracketTarget) whose
      //      per-year override bumps rothBracketTarget to 32% for one year
      //      would have had that override silently retarget CONVERSIONS to
      //      32% too, even though nothing about a withdrawal-routing
      //      override should touch the conversion target. Never shipped
      //      wrong numbers (buildCandidateInput always pairs an explicit
      //      rothConversionTarget when conversions are on, bypassing this
      //      fallback), but was a real, reachable bug for any household
      //      that later creates that override combination by hand.
      //   3. taxRates.rothBracketTarget -- final fallback when nothing else
      //      is set, same as before.
      // See fixtures 31/41/54/55/61 (engine-snapshot.test.ts) and the Bug-B
      // MAGI test (roth-growth-magi-tax-fix.test.ts) for why
      // taxRates.rothConversionTarget can't simply be dropped from this
      // chain -- and the priority-ordering regression test alongside them
      // for why it can't come second either.
      //
      // Reuses resolvedConversionTarget (computed once, above, before
      // routeForMode) instead of re-deriving the identical chain a second
      // time here -- the routing reservation and the conversion that
      // actually runs must agree on this value, or the two silently drift
      // (see resolvedConversionTarget's own
      // comment).
      rothBracketTarget: resolvedConversionTarget,
      totalTraditionalWithdrawal,
      taxableSS,
      rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
      brokerageGainsPortion,
      irmaaAwareRothConversions:
        input.irmaaAwareRothConversions ??
        (enableIrmaaAwareness ? true : undefined),
      irmaaBrackets: grownIrmaaBracketsForCap,
      filingStatus,
      balances,
      acctBal,
      // Without this, performRothConversion's own
      // fixes above are fully implemented and fully unit-tested but never
      // execute in production, since "params omitted" is deliberately the
      // unchanged-behavior fallback.
      nonRetirement,
      indAccts: hasIndividualAccounts ? indAccts : undefined,
      indBal: hasIndividualAccounts ? indBal : undefined,
      indKey: hasIndividualAccounts ? indKey : undefined,
      rmdSmoothingTarget,
      rmdSmoothingMaxBracketTarget: config.rmdSmoothingMaxBracketTarget,
    }),
  );
  const {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  } = rothResult;

  // Roth conversions are ordinary income and can push the gains into a higher
  // LTCG bracket: recompute on the revised ordinary income, converted once to
  // the taxable income the LTCG calls below use (they're its only readers).
  let postConversionLtcgRate: number;
  const revisedOrdinary = toLtcgTaxableIncome(
    actualTaxableIncome + rothConversionAmount,
    grownStandardDeduction,
  );
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    brokerageTaxCost = roundToCents(
      computeLtcgTax(
        revisedOrdinary,
        brokerageGainsPortion,
        filingStatus,
        grownLtcgBrackets,
      ),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      revisedOrdinary + brokerageGainsPortion,
      filingStatus,
      grownLtcgBrackets,
    );
    // Re-price the year with the revised brokerage tax through the same
    // computeTaxFromSlots call — a hand copy of its formula here once
    // dropped non-qualified Roth growth, and then taxable Social Security.
    taxCost = priceTax(taxableSS, brokerageTaxCost).taxCost;
  } else {
    // Display-only: marginal bracket at the ceiling of the gains stack.
    // No tax is actually computed from this value.
    postConversionLtcgRate =
      brokerageGainsPortion > 0 && filingStatus
        ? getLtcgRate(
            revisedOrdinary + brokerageGainsPortion,
            filingStatus,
            grownLtcgBrackets,
          )
        : brokerageGainsPortion > 0
          ? taxRates.brokerage
          : filingStatus
            ? getLtcgRate(revisedOrdinary, filingStatus, grownLtcgBrackets)
            : taxRates.brokerage;
  }

  const income: YearIncome = {
    traditionalDraws: totalTraditionalWithdrawal,
    rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
    rothConversions: rothConversionAmount,
    realizedGains: brokerageGainsPortion,
    socialSecurity: { gross: ssIncome, taxable: taxableSS },
  };
  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  // Applies to lesser of net investment income or MAGI exceeding threshold.
  // Roth conversions raise MAGI but are NOT net investment income.
  const currentYearMagi = yearMagi(income, "niit");
  const niitAmount = filingStatus
    ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
    : 0;
  if (niitAmount > 0) {
    taxCost = roundToCents(taxCost + niitAmount);
  }

  // Funding-shortfall reconciliation (alongside
  // the withdrawal-solver.ts secant-convergence fix). routedUnmetNeed only fires
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
  // A withdrawal-sized year (Social Security on top) has no spending need
  // of its own: its shortfall is the part of the strategy's amount that
  // couldn't leave the portfolio — not tax that changed after routing
  // (conversion-year capital gains, NIIT), which only lowers what's spent.
  // (Social Security's surplus paid part of the tax: it covers the need too.)
  const fundingShortfall = roundToCents(
    state.portfolioWithdrawal !== null
      ? Math.max(0, state.portfolioWithdrawal - totalWithdrawal)
      : Math.max(0, afterTaxNeed - deliveredAfterTax - surplusCredit(taxCost)),
  );
  // Materiality floor, not a correctness tolerance (SHORTFALL_MATERIALITY).
  const shortfallMaterialityFloor = shortfallFloor(afterTaxNeed);
  const finalUnmetNeed =
    fundingShortfall > shortfallMaterialityFloor
      ? Math.max(routedUnmetNeed ?? 0, fundingShortfall)
      : routedUnmetNeed;
  // Single canonical "is this a REAL shortfall worth alerting on" verdict
  // `finalUnmetNeed` above intentionally
  // preserves its existing byte-identical value/undefined-ness for
  // existing consumers (an additive field), but its own two branches
  // apply the materiality floor
  // inconsistently: the `routedUnmetNeed` fallback branch is NEVER
  // floor-filtered, so a rounding-scale routed residual could read as
  // `unmetNeed > 0` without being material. Chart/table/KPI alerting
  // should all key off THIS field, not re-derive materiality themselves
  // (three independent re-derivations is how a chart marker and a table
  // line end up disagreeing about the same year).
  //
  // grossUpForTaxes:false households net out the tax+penalty portion of
  // fundingShortfall before checking materiality.
  // With that setting off, the household has deliberately
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
