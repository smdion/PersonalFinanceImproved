import { ProjectionTable } from "../projection-table";
import { ProjectionTableSkeleton } from "../projection-table-skeleton";
import type {
  ProjectionState,
  ProjectionTableProps,
} from "../projection-table-types";

export function TableArea({
  reportMode,
  engineQuery,
  autoloadEnabled,
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
  reportMode: "none" | "basic" | "advisor";
  engineQuery: ProjectionState["engineQuery"];
  autoloadEnabled: ProjectionState["autoloadEnabled"];
}) {
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
