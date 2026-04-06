// Shared types for spreadsheet view components.
// These mirror the shapes returned by trpc.networth.computeDetailedHistory.
// Types are duplicated here (not imported from server) per lint rules:
// components cannot import server modules directly.

/** Per-category performance breakdown (contributions, gains, distributions). */
export type CategoryPerformance = {
  endingBalance: number;
  contributions: number;
  employerMatch: number;
  gainLoss: number;
  distributions: number;
};

/** Tax-type distribution within a parent category. */
export type TaxLocationBreakdown = {
  retirement: Record<string, number>;
  portfolio: Record<string, number>;
};

export type DetailedHistoryRow = {
  year: number;
  netWorth: number;
  netWorthCostBasis: number;
  netWorthMarket: number;
  portfolioTotal: number;
  portfolioByType: Record<string, number>;
  cash: number;
  houseValue: number;
  mortgageBalance: number;
  otherAssets: number;
  otherLiabilities: number;
  grossIncome: number;
  combinedAgi: number;
  isCurrent: boolean;
  perfLastUpdated: string | null;
  perfContributions: number | null;
  perfGainLoss: number | null;
  performanceByCategory: Record<string, CategoryPerformance>;
  portfolioByTaxLocation: TaxLocationBreakdown | null;
  /** Fraction of year elapsed. 1.0 for finalized years. Used to annualize YTD flow metrics. */
  ytdRatio: number;
  // Pre-computed metrics (from buildYearEndHistory — single computation path)
  wealthScore: number;
  aawScore: number;
  fiProgress: number;
  fiTarget: number;
  averageAge: number;
  effectiveIncome: number;
  lifetimeEarnings: number;
};
