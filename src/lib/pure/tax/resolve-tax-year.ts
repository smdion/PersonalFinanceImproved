/** The engine payload's tax year. */
import { filingRules } from "@/lib/config/filing-status";
import type { retirementFilingStatus } from "@/lib/pure/tax/filing-status";
import {
  resolveTaxParams,
  type TaxParamsRowSets,
  type TaxSection,
} from "@/lib/pure/tax/resolve-tax-params";
import {
  ACCOUNT_LIMIT_KEYS,
  requireTaxLimitKey,
} from "@/lib/config/tax-limit-keys";

/**
 * The tax year every per-year slice is resolved on, through one call,
 * and the plan's withholding table. A missing table stops the
 * projection rather than pricing that tax at a guess.
 */
export function resolveTaxYear(
  filingStatus: ReturnType<typeof retirementFilingStatus>,
  retProfiles: readonly { id: number; taxParamsYear: number | null }[],
  activeProfileId: number | null,
  allTaxParams: TaxParamsRowSets["vintage"],
  allLimits: TaxParamsRowSets["contributionLimits"],
  allTaxBrackets: TaxParamsRowSets["withholdingBrackets"],
  allLtcgBrackets: TaxParamsRowSets["ltcgBrackets"],
  allIrmaaBrackets: TaxParamsRowSets["irmaaBrackets"],
  allFplByHousehold: TaxParamsRowSets["fpl"],
) {
  // The active profile's pinned year (`tax_params_year`, null: the newest
  // enacted), even for a historical snapshot. An unseeded pin year takes
  // the newest earlier one: the projection grows it forward.
  const activeProfile = retProfiles.find((p) => p.id === activeProfileId);
  const requestedTaxYear = activeProfile?.taxParamsYear ?? undefined;
  const resolvedTax = resolveTaxParams(
    {
      vintage: allTaxParams,
      contributionLimits: allLimits,
      withholdingBrackets: allTaxBrackets,
      ltcgBrackets: allLtcgBrackets,
      irmaaBrackets: allIrmaaBrackets,
      fpl: allFplByHousehold,
    },
    requestedTaxYear,
    // Each table from its own newest complete year (a new year's limits
    // can land before its withholding/IRMAA/FPL tables) — the engine grows
    // each from that year.
    { onMissing: "nearest", sectionFallback: true },
  );
  const latestTaxYear = resolvedTax.resolvedYear;
  // No complete year of a table means an emptied one (the tax-data file is
  // applied on every start and restore). Nothing stands in for it.
  const sectionNames: Record<TaxSection, string> = {
    withholding: "withholding tables (Tax Brackets)",
    ltcg: "capital-gains brackets (LTCG Brackets)",
    irmaa: "Medicare brackets (IRMAA Tables)",
    fpl: "poverty levels (ACA/FPL)",
  };
  const missingSections = resolvedTax.missing ?? [];
  const ltcgBracketData = resolvedTax.ltcgByStatus;
  const irmaaBracketData = resolvedTax.irmaaByStatus;
  const fplByHouseholdData = resolvedTax.fplByHousehold;
  if (
    missingSections.length > 0 ||
    !ltcgBracketData ||
    !irmaaBracketData ||
    !fplByHouseholdData
  )
    throw new Error(
      `Tax data is missing: no complete year of ${
        missingSections.map((s) => sectionNames[s]).join(", ") || "a tax table"
      } (Settings → Reference Data).`,
    );

  // A complete year has every status's table: never a guessed empty one.
  const withholding =
    resolvedTax.withholdingBrackets?.[filingRules(filingStatus).survivorRow]
      ?.false;
  if (!withholding) throw new Error(`No ${filingStatus} withholding table.`);
  const bracketData = withholding as {
    threshold: number;
    baseWithholding: number;
    rate: number;
  }[];

  return {
    resolvedTax,
    latestTaxYear,
    missingLimitsWarning: missingLimitsWarning(
      resolvedTax.limits,
      allLimits,
      latestTaxYear,
    ),
    ltcgBracketData,
    irmaaBracketData,
    fplByHouseholdData,
    bracketData,
  };
}

/** An account-type IRS limit an earlier year has and the resolved year
 *  lacks reads as a $0 limit in the contribution caps: say which. */
export function missingLimitsWarning(
  limits: Record<string, number>,
  allLimits: readonly { taxYear: number; limitType: string }[],
  taxYear: number,
): string[] {
  const missing = new Set(
    allLimits
      .filter((r) => r.taxYear < taxYear && ACCOUNT_LIMIT_KEYS.has(r.limitType))
      .map((r) => r.limitType)
      .filter((key) => !(key in limits)),
  );
  if (missing.size === 0) return [];
  const names = [...missing].map((key) => {
    const entry = requireTaxLimitKey(key);
    return `${entry.group} ${entry.label.toLowerCase()}`;
  });
  return [
    `The ${taxYear} tax data has no ${names.join(", ")} limit, so it counts as $0. Add it in Settings → Reference Data.`,
  ];
}
