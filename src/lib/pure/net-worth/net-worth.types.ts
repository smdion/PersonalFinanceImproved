/** calculateNetWorth's input and result: net worth at market and at
 *  cost, wealth scores and FI progress. */

export type NetWorthInput = {
  portfolioTotal: number;
  cash: number;
  homeValueEstimated: number; // current market estimate (for NW+)
  homeValueConservative: number; // purchase price + improvements (for NW-)
  otherAssets: number;
  mortgageBalance: number; // current amortized balance
  otherLiabilities: number;
  averageAge: number; // average of all people's ages (was: primary person only)
  effectiveIncome: number; // combinedAgi, optionally 3yr averaged (was: annualSalary)
  lifetimeEarnings: number; // cumulative AGI through this year
  annualExpenses: number;
  withdrawalRate: number; // e.g. 0.04 for the 4% rule — from retirement settings
  asOfDate: Date;
};

export type NetWorthResult = {
  netWorthMarket: number; // uses current market value for home
  netWorthCostBasis: number; // uses purchase price + improvements for home
  netWorth: number; // alias for netWorthMarket (primary display)
  totalAssets: number;
  totalLiabilities: number;
  wealthScoreMarket: number; // netWorthMarket / lifetimeEarnings
  wealthScoreCostBasis: number; // netWorthCostBasis / lifetimeEarnings
  aawScoreMarket: number; // Money Guy formula using market NW
  aawScoreCostBasis: number; // Money Guy formula using cost basis NW
  fiProgress: number;
  fiTarget: number;
  warnings: string[];
};
