/** Shared TypeScript types for the projection table, including the full ProjectionState shape and table component props. */
import type { useProjectionState } from "./use-projection-state";

export type ProjectionState = ReturnType<typeof useProjectionState>;

/** What the print buttons asked for: nothing, the chart and table, or the advisor report. */
export type ReportMode = "none" | "basic" | "advisor";

export type ProjectionTableProps = {
  state: ProjectionState;
  people?: { id: number; name: string; birthYear: number }[];
  parentCategoryFilter?: string;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
};
