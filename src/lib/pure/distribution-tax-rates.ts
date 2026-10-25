/**
 * The distribution tax rates and deductions the projection engine reads —
 * flat fallback rates (estimated from the year's brackets when seeded),
 * the standard and senior deductions, and the bracket tables themselves.
 * Pure: every input is already resolved by the payload builder.
 */
import { estimateEffectiveTaxRate } from "@/lib/calculators/engine";
import { getLtcgRate } from "@/lib/config/tax-tables";
import { requireLimit } from "@/server/helpers/settings";
import { toNumber } from "@/server/helpers/transforms";
import type { resolveTaxParams } from "@/lib/config/tax-params";

type Decimal = string | null | undefined;
type ResolvedTax = ReturnType<typeof resolveTaxParams>;

export type DistributionTaxRateInput = {
  settings: {
    distributionTaxRateTraditional: Decimal;
    distributionTaxRateBrokerage: Decimal;
    distributionTaxRateRoth: Decimal;
    distributionTaxRateHsa: Decimal;
    taxMultiplier: Decimal;
    grossUpForTaxes: boolean;
    rothBracketTarget: Decimal;
    enableRothConversions: boolean;
    rothConversionTarget: Decimal;
  };
  filingStatus: Parameters<typeof getLtcgRate>[1] | null;
  limitsMap: Record<string, number>;
  bracketData: { threshold: number; baseWithholding: number; rate: number }[];
  ltcgBracketData: ResolvedTax["ltcgByStatus"];
  irmaaBracketData: ResolvedTax["irmaaByStatus"];
  fplByHousehold: ResolvedTax["fplByHousehold"];
  latestTaxYear: number;
  /** The year each table came from (resolveTaxParams `sectionYears`);
   *  undefined = every table is `latestTaxYear`'s. */
  sectionYears?: ResolvedTax["sectionYears"];
  taxParamsVersion: ResolvedTax["version"];
  accumulationExpenses: number;
  decumulationExpenses: number;
  annualExpensesVal: number;
};

export function buildDistributionTaxRates({
  settings,
  filingStatus,
  limitsMap,
  bracketData,
  ltcgBracketData,
  irmaaBracketData,
  fplByHousehold,
  latestTaxYear,
  sectionYears,
  taxParamsVersion,
  accumulationExpenses,
  decumulationExpenses,
  annualExpensesVal,
}: DistributionTaxRateInput) {
  // Distribution tax rates (shared between engine and MC)
  // When bracket data is available, estimate effective rates from brackets instead of using
  // flat DB values (which may be stale or overly conservative, e.g. flat 22% vs actual ~12-15%)
  // Distribution tax rates now live on the active profile's settings row,
  // relocated in step A from `retirement_scenarios` — a table the engine read
  // on every build but which had NO UI at all, so these rates shaped every
  // projection while being invisible and uneditable.
  //
  // The `!= null ? x : 0` shape is a deliberate transcription of the old
  // `selectedScenario ? x : 0`: null means "no selected scenario existed",
  // which is NOT the same as a household choosing 0%. Identical output,
  // and the distinction survives for the later "should these actually
  // default to DEFAULT_TAX_RATE_*?" decision.
  const dbTraditionalRate =
    settings.distributionTaxRateTraditional != null
      ? toNumber(settings.distributionTaxRateTraditional)
      : 0;
  const dbBrokerageRate =
    settings.distributionTaxRateBrokerage != null
      ? toNumber(settings.distributionTaxRateBrokerage)
      : 0;
  const taxMult = toNumber(settings.taxMultiplier);

  let effectiveTraditionalRate = dbTraditionalRate;
  let effectiveBrokerageRate = dbBrokerageRate;

  // The standard deduction and the §63(f) senior deduction are
  // permanent, evergreen figures — the IRS publishes a value for them
  // every year, so a resolved tax year with no row for one is a genuine
  // seed-completeness bug, not a legitimate state. `requireLimit` throws
  // rather than silently computing on gross income with no deduction
  // (the year-boundary class of bug this whole mechanism exists to
  // close). Hoisted above its other use (distributionTaxRates.standardDeduction
  // below) so the fallback-rate estimate uses the same value —
  // computing it twice would risk the two silently drifting.
  const standardDeductionForFilingStatus = filingStatus
    ? requireLimit(
        limitsMap,
        `standard_deduction_${filingStatus.toLowerCase()}`,
      )
    : undefined;

  // IRC §63(f)(1) additional standard deduction for filers 65+. One
  // amount for married filers (per qualifying spouse), a larger one for
  // unmarried (Single/HoH). The decumulation-year handler multiplies this by
  // how many household members are 65+ in each projection year — nearly
  // every decumulation year for a real household — and folds it into the
  // standard deduction before growth. Also evergreen (IRC §63(f) doesn't
  // expire) — `requireLimit`, same reasoning as the base deduction above.
  const additionalStdDeduction65PerSenior = filingStatus
    ? requireLimit(
        limitsMap,
        filingStatus === "MFJ"
          ? "additional_std_deduction_65_married"
          : "additional_std_deduction_65_unmarried",
      )
    : undefined;

  // OBBBA temporary senior deduction (One Big Beautiful Bill Act, 2025) —
  // $6,000/person 65+, 2025-2028 only, phased out 6% of MAGI above
  // $150k MFJ / $75k Single/HoH/MFS. Separate lever from §63(f) above;
  // folded into the standard deduction alongside it in decumulation-year.ts
  // using LAST YEAR's MAGI as the phaseout basis (see
  // obbba-senior-deduction.ts's docblock for why — same circularity IRMAA's
  // 2-year lookback already breaks).
  //
  // Deliberately KEPT undefined-tolerant (bare `limitsMap[key]`, not
  // `requireLimit`), unlike the two evergreen deductions above: OBBBA is
  // statutorily self-expiring (obbbaSeniorSunsetYear gates
  // computeObbbaSeniorDeduction's own `year > sunsetYear ⇒ 0`), so a
  // future tax year seeded AFTER 2028 that correctly omits these rows
  // must degrade to "no OBBBA deduction," not throw. Making this strict
  // would turn a legitimate post-sunset state into a crash.
  const obbbaSeniorDeductionPerPerson =
    limitsMap["obbba_senior_deduction_per_person"];
  const obbbaSeniorPhaseoutStart = filingStatus
    ? filingStatus === "MFJ"
      ? limitsMap["obbba_senior_deduction_phaseout_start_mfj"]
      : limitsMap["obbba_senior_deduction_phaseout_start_unmarried"]
    : undefined;
  const obbbaSeniorPhaseoutRate =
    limitsMap["obbba_senior_deduction_phaseout_rate"];
  const obbbaSeniorSunsetYear = limitsMap["obbba_senior_deduction_sunset_year"];

  if (bracketData.length > 0) {
    // Estimate effective income tax rate at retirement income level.
    // Use decumulation budget when set (it's the actual retirement spending level);
    // fall back to accumulation budget otherwise.
    const retirementIncome =
      decumulationExpenses !== accumulationExpenses
        ? decumulationExpenses
        : annualExpensesVal;
    // NOTE: deliberately the FLAT filing-status deduction, not the
    // age-65+ senior-adjusted figure. This is a single scalar fallback rate
    // used only when no tax brackets are seeded; it can't be per-projection-
    // year age-aware. The real per-year LTCG/tax path applies the §63(f)
    // addition in decumulation-year.ts. Do not "consolidate" the two.
    const estimatedRate = estimateEffectiveTaxRate(
      retirementIncome,
      bracketData,
      taxMult,
      standardDeductionForFilingStatus,
    );
    // Only override if we get a meaningful estimate (bracket data is valid)
    if (estimatedRate > 0) {
      effectiveTraditionalRate = estimatedRate;
    }
    // LTCG fallback flat rate: real bracket-based rate at this income level,
    // via the same LTCG bracket table (DB-loaded when seeded, hardcoded
    // 2026 federal defaults otherwise) the actual per-year tax pricing
    // uses — replaces a prior heuristic that checked retirement income
    // against the *ordinary* 12%-bracket threshold as a proxy for the LTCG
    // 0% zone, which silently overstated 0%-LTCG headroom (the two bracket
    // tables have different thresholds).
    // This value is only ever the FALLBACK used when filingStatus is
    // unavailable to a caller — the primary pricing path always uses
    // computeLtcgTax with the real bracket table directly.
    effectiveBrokerageRate = filingStatus
      ? getLtcgRate(retirementIncome, filingStatus, ltcgBracketData)
      : dbBrokerageRate;
  }

  return {
    traditionalFallbackRate: effectiveTraditionalRate,
    roth:
      settings.distributionTaxRateRoth != null
        ? toNumber(settings.distributionTaxRateRoth)
        : 0,
    hsa:
      settings.distributionTaxRateHsa != null
        ? toNumber(settings.distributionTaxRateHsa)
        : 0,
    brokerage: effectiveBrokerageRate,
    taxBrackets: bracketData.length > 0 ? bracketData : undefined,
    ltcgBrackets: ltcgBracketData,
    irmaaBrackets: irmaaBracketData,
    fplByHousehold: fplByHousehold,
    // Each table's own year, set exactly when the table is (taxTableYears).
    taxBracketsYear:
      bracketData.length > 0
        ? (sectionYears?.withholding ?? latestTaxYear)
        : undefined,
    ltcgBracketsYear: ltcgBracketData
      ? (sectionYears?.ltcg ?? latestTaxYear)
      : undefined,
    irmaaBracketsYear: irmaaBracketData
      ? (sectionYears?.irmaa ?? latestTaxYear)
      : undefined,
    fplYear: fplByHousehold ? (sectionYears?.fpl ?? latestTaxYear) : undefined,
    taxMultiplier: taxMult,
    grossUpForTaxes: settings.grossUpForTaxes,
    rothBracketTarget: toNumber(settings.rothBracketTarget ?? "0.12"),
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget:
      settings.rothConversionTarget != null
        ? toNumber(settings.rothConversionTarget)
        : undefined,
    // Paired with `toLtcgTaxableIncome` (tax-tables.ts):
    // LTCG bracket lookups need real taxable income, not gross ordinary
    // income — this sources the deduction from real config
    // (`contribution_limits`, already loaded into limitsMap above) rather
    // than a hardcoded constant. Same key format `paycheck.ts`'s own
    // standard-deduction lookup uses. Undefined when not seeded for this
    // filing status ⇒ the LTCG helper subtracts 0, reproducing pre-fix
    // behavior rather than throwing.
    standardDeduction: standardDeductionForFilingStatus,
    // IRC §63(f) age-65+ additional standard deduction, per qualifying
    // senior, filing-status-resolved. decumulation-year.ts scales it
    // by the 65+ headcount for each projection year and folds it into the
    // deduction before growth.
    additionalStdDeduction65PerSenior,
    // OBBBA temporary senior deduction (2025-2028) — see this file's own
    // resolution above for how each figure is sourced.
    obbbaSeniorDeductionPerPerson,
    obbbaSeniorPhaseoutStart,
    obbbaSeniorPhaseoutRate,
    obbbaSeniorSunsetYear,
    // The actual calendar year `bracketData`/`standardDeductionForFilingStatus`
    // were seeded for — NOT necessarily "this year." See
    // `DecumulationDefaults.distributionTaxRates.taxDataYear`'s docblock
    // (engine-config.ts) for why this matters: without it, every one of
    // these values reads as flat-nominal forever in the engine, which is
    // wrong once real inflation-indexed brackets are grown forward off it.
    taxDataYear: latestTaxYear,
    // The `tax_params` vintage revision for `taxDataYear`. Informational
    // (a "Tax data: 2026, rev N" label) — but threaded into the engine input
    // so a vintage bump is explicit in `hashEngineInput`'s digest rather than
    // only implicit via the resolved values.
    taxParamsVersion: taxParamsVersion,
  };
}
