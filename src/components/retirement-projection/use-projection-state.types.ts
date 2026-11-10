/** The projection state hook's props and the row shapes it hands its callers. */

/** Contribution rate schedule entry derived from engine results, for relocation analysis. */
export type EngineContributionRate = { year: number; rate: number };

/** Per-category account breakdown with display names (for balance tooltips). */
export type AccountBreakdown = {
  name: string;
  amount: number;
  taxType: string;
  ownerName?: string;
  ownerPersonId?: number;
  accountType?: string;
  parentCategory?: string;
};

export type UseProjectionStateProps = {
  people?: { id: number; name: string; birthYear: number }[];
  onContributionRates?: (rates: EngineContributionRate[]) => void;
  withdrawalRate: number;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  parentCategoryFilter?: string;
  contributionProfileId?: number;
  /** Independent Salary Profile axis. */
  salaryProfileId?: number;
  /** View a non-active Retirement Profile — see ProjectionCard's matching
   *  prop docblock (index.tsx). */
  retirementProfileId?: number | null;
  snapshotId?: number;
};
