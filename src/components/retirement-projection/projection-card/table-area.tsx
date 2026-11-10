import { ProjectionTable } from "../table/projection-table";
import { ProjectionTableSkeleton } from "../table/projection-table-skeleton";
import type {
  ProjectionTableProps,
  ReportMode,
} from "../projection-table-types";

export function TableArea({
  reportMode,
  state,
  people,
  parentCategoryFilter,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
}: ProjectionTableProps & {
  reportMode: ReportMode;
}) {
  const { engineQuery, autoloadEnabled } = state;
  return (
    <div className={reportMode === "advisor" ? "print:hidden" : undefined}>
      {engineQuery.isLoading || (!autoloadEnabled && !engineQuery.data) ? (
        <ProjectionTableSkeleton />
      ) : (
        <ProjectionTable
          state={state}
          people={people}
          parentCategoryFilter={parentCategoryFilter}
          accumulationBudgetProfileId={accumulationBudgetProfileId}
          accumulationBudgetColumn={accumulationBudgetColumn}
          accumulationExpenseOverride={accumulationExpenseOverride}
          decumulationBudgetProfileId={decumulationBudgetProfileId}
          decumulationBudgetColumn={decumulationBudgetColumn}
          decumulationExpenseOverride={decumulationExpenseOverride}
        />
      )}
    </div>
  );
}
