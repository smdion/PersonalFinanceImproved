/**
 * The distribution tax rates and deductions the projection engine reads: flat fallback rates,
 * the standard and senior deductions, and the bracket tables. Inputs arrive already resolved.
 */
import { estimateEffectiveTaxRate } from "@/lib/pure/engine";
import { getLtcgRate } from "@/lib/pure/tax/ltcg";
import { requireLimit } from "@/lib/pure/tax/tax-limits";
import { toNumber } from "@/lib/utils/numbers";
import { DEFAULT_ROTH_BRACKET_TARGET } from "@/lib/constants";
import type { resolveTaxParams } from "@/lib/config/tax-params";

type Decimal = string | null | undefined;
type ResolvedTax = ReturnType<typeof resolveTaxParams>;

type DistributionTaxRateInput = {
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
  ltcgBracketData: NonNullable<ResolvedTax["ltcgByStatus"]>;
  irmaaBracketData: NonNullable<ResolvedTax["irmaaByStatus"]>;
  fplByHousehold: NonNullable<ResolvedTax["fplByHousehold"]>;
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
  // Flat distribution tax rates from the active profile's settings row (estimated from brackets
  // below when seeded). Null means unset and reads as 0, which is not a household choosing 0%.
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

  // Standard and §63(f) senior deductions are published every year, so a missing row is a seed
  // bug: `requireLimit` throws rather than compute with no deduction. Resolved once here for
  // both the fallback-rate estimate and distributionTaxRates.standardDeduction.
  const standardDeductionForFilingStatus = filingStatus
    ? requireLimit(
        limitsMap,
        `standard_deduction_${filingStatus.toLowerCase()}`,
      )
    : undefined;

  // IRC §63(f)(1) additional standard deduction per 65+ filer (married per qualifying spouse,
  // a larger unmarried figure). decumulation-year scales it by the year's 65+ headcount and folds
  // it into the standard deduction; it doesn't expire, hence `requireLimit`.
  const additionalStdDeduction65PerSenior = filingStatus
    ? requireLimit(
        limitsMap,
        filingStatus === "MFJ"
          ? "additional_std_deduction_65_married"
          : "additional_std_deduction_65_unmarried",
      )
    : undefined;

  // OBBBA temporary senior deduction: $6,000/person 65+, 2025-2028, phased out 6% of last
  // year's MAGI above $150k MFJ / $75k otherwise (see return-deductions.ts). Read without
  // `requireLimit`: after the sunset, missing rows mean no deduction.
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
    // The flat filing-status deduction, not the 65+ figure: a single fallback rate used only
    // without seeded brackets; per-year §63(f) is applied in decumulation-year.ts.
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
    // LTCG fallback: the real LTCG bracket rate at this income (DB brackets when seeded, else
    // 2026 federal defaults). Only used when a caller lacks filingStatus; the primary path
    // prices with computeLtcgTax directly.
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
    // Each table's own year (taxTableYears grows each from it).
    taxBracketsYear: sectionYears?.withholding ?? latestTaxYear,
    ltcgBracketsYear: sectionYears?.ltcg ?? latestTaxYear,
    irmaaBracketsYear: sectionYears?.irmaa ?? latestTaxYear,
    fplYear: sectionYears?.fpl ?? latestTaxYear,
    taxMultiplier: taxMult,
    grossUpForTaxes: settings.grossUpForTaxes,
    rothBracketTarget: toNumber(
      settings.rothBracketTarget ?? String(DEFAULT_ROTH_BRACKET_TARGET),
    ),
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget:
      settings.rothConversionTarget != null
        ? toNumber(settings.rothConversionTarget)
        : undefined,
    // Paired with `toLtcgTaxableIncome` (tax/ltcg.ts): LTCG lookups need taxable income. From
    // `contribution_limits`; undefined when not seeded, and the LTCG helper subtracts 0.
    standardDeduction: standardDeductionForFilingStatus,
    // IRC §63(f) 65+ additional standard deduction per qualifying senior; decumulation-year.ts
    // scales it by the year's 65+ headcount and folds it in before growth.
    additionalStdDeduction65PerSenior,
    // OBBBA temporary senior deduction (2025-2028) — see this file's own
    // resolution above for how each figure is sourced.
    obbbaSeniorDeductionPerPerson,
    obbbaSeniorPhaseoutStart,
    obbbaSeniorPhaseoutRate,
    obbbaSeniorSunsetYear,
    // Evergreen (IRC 408(d)(8)), so required like the deductions above.
    qcdAnnualLimit: requireLimit(limitsMap, "qcd_annual_limit"),
    // The year `bracketData`/`standardDeductionForFilingStatus` were seeded for, not
    // necessarily this year, so the engine grows indexed values from the right base (see
    // `DecumulationDefaults.distributionTaxRates.taxDataYear`).
    taxDataYear: latestTaxYear,
    // The `tax_params` vintage revision for `taxDataYear`: shown as a label, and in the engine
    // input so a vintage bump changes `hashEngineInput`'s digest explicitly.
    taxParamsVersion: taxParamsVersion,
  };
}
