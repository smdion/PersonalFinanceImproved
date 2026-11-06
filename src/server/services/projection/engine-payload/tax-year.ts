/** The engine payload's tax year. */
import type { retirementFilingStatus } from "@/lib/pure/tax/filing-status";
import { resolveTaxParams, type TaxSection } from "@/lib/config/tax-params";
import type { fetchRetirementData } from "./load";

/**
 * The tax year every per-year slice is resolved on, through one call,
 * and the plan's withholding table. A missing table stops the
 * projection rather than pricing that tax at a guess.
 */
export function resolveTaxYear(
  filingStatus: ReturnType<typeof retirementFilingStatus>,
  retProfiles: Awaited<ReturnType<typeof fetchRetirementData>>["retProfiles"],
  activeProfileId: number | null,
  allTaxParams: Awaited<ReturnType<typeof fetchRetirementData>>["allTaxParams"],
  allLimits: Awaited<ReturnType<typeof fetchRetirementData>>["allLimits"],
  allTaxBrackets: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allTaxBrackets"],
  allLtcgBrackets: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allLtcgBrackets"],
  allIrmaaBrackets: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allIrmaaBrackets"],
  allFplByHousehold: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allFplByHousehold"],
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
  const withholding = resolvedTax.withholdingBrackets?.[filingStatus]?.false;
  if (!withholding) throw new Error(`No ${filingStatus} withholding table.`);
  const bracketData = withholding as {
    threshold: number;
    baseWithholding: number;
    rate: number;
  }[];

  return {
    resolvedTax,
    latestTaxYear,
    ltcgBracketData,
    irmaaBracketData,
    fplByHouseholdData,
    bracketData,
  };
}
