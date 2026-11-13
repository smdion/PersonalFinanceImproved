/**
 * The distribution tax rates and deductions the projection engine reads: flat fallback rates,
 * the standard and senior deductions, and the bracket tables. Inputs arrive already resolved.
 */
import { estimateEffectiveTaxRate } from "@/lib/pure/engine";
import { getLtcgRate } from "@/lib/pure/tax/ltcg";
import { requireLimit } from "@/lib/pure/tax/tax-limits";
import { returnDeductionTerms } from "@/lib/pure/tax/return-deductions";
import { toNumber } from "@/lib/utils/numbers";
import { DEFAULT_ROTH_BRACKET_TARGET } from "@/lib/constants";
import type { resolveTaxParams } from "@/lib/pure/tax/resolve-tax-params";

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
    rothBracketOverlay: boolean | null;
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

  // The basic deduction, the §63(f) add-on per 65+ person and the senior deduction's terms
  // (return-deductions.ts); the basic one also feeds the fallback-rate estimate.
  const deductionTerms = returnDeductionTerms(limitsMap, filingStatus);
  const standardDeductionForFilingStatus = deductionTerms.basic;

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
    // The LTCG rate at retirement spending, no deduction taken off. Brokerage goal draws price
    // their gains at it (goal-draws.ts), as does a year without a filing status; a year's draws
    // with one are priced by scheduleDGainsTax.
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
    rothBracketOverlay: settings.rothBracketOverlay,
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget:
      settings.rothConversionTarget != null
        ? toNumber(settings.rothConversionTarget)
        : undefined,
    // Paired with `ltcgStackBase` (tax/ltcg.ts): LTCG lookups need taxable income. From
    // `contribution_limits`; undefined when not seeded, and the LTCG helper subtracts 0.
    standardDeduction: standardDeductionForFilingStatus,
    additionalStdDeduction65PerSenior: deductionTerms.addOnPerCondition,
    obbbaSeniorDeductionPerPerson: deductionTerms.senior.perPerson,
    obbbaSeniorPhaseoutStart: deductionTerms.senior.phaseoutStart,
    obbbaSeniorPhaseoutRate: deductionTerms.senior.phaseoutRate,
    obbbaSeniorSunsetYear: deductionTerms.senior.sunsetYear,
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
