// Shared types for net worth components
// Color constants have been moved to @/lib/utils/colors (CHART_COLORS, TAX_PIE_COLORS)

export type HistoryRow = {
  year: number;
  netWorth: number;
  netWorthCostBasis?: number;
  portfolioTotal: number;
  cash: number;
  houseValue: number;
  houseValueCostBasis?: number;
  mortgageBalance: number;
  totalLiabilities: number;
  grossIncome: number;
  isCurrent: boolean;
  [key: string]: unknown;
};

export { compactCurrency } from "@/lib/utils/format";
