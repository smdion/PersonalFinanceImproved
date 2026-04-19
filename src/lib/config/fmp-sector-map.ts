/**
 * Maps FMP (Financial Modeling Prep) sector strings to asset_class_params.name values.
 *
 * CONTRACT: Values must exactly match asset_class_params.name in the database.
 * Verify against `SELECT name FROM asset_class_params ORDER BY name` before
 * adding a new mapping. A wrong name silently fails to match and the user
 * falls back to manual classification.
 *
 * null = FMP sector alone is insufficient to classify (e.g. generic "ETF") —
 * user must classify manually.
 */
export const FMP_SECTOR_TO_ASSET_CLASS: Record<string, string | null> = {
  // Equity sectors — all map to US Equities
  Technology: "US Equities",
  "Financial Services": "US Equities",
  Healthcare: "US Equities",
  "Consumer Cyclical": "US Equities",
  Industrials: "US Equities",
  "Communication Services": "US Equities",
  "Consumer Defensive": "US Equities",
  Energy: "US Equities",
  "Basic Materials": "US Equities",
  Utilities: "US Equities",

  // Real estate gets its own asset class
  "Real Estate": "Real Estate",

  // ETF / fund categories (FMP only returns generic "ETF" — user must classify)
  ETF: null,
};
