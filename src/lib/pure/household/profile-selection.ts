// Which profiles a projection request runs on. An absent key means the
// active profile, which the engine payload resolves (build-engine-payload.ts).
import type { ProfileSelection } from "./profile-selection.schema";

/** A page's picks, each null or absent when it shows the active one. */
type ProfilePicks = {
  contributionProfileId?: number | null;
  salaryProfileId?: number | null;
  retirementProfileId?: number | null;
  accumulationBudgetProfileId?: number | null;
  accumulationBudgetColumn?: number | null;
  accumulationExpenseOverride?: number | null;
  decumulationBudgetProfileId?: number | null;
  decumulationBudgetColumn?: number | null;
  decumulationExpenseOverride?: number | null;
};

function budgetSource(
  profileId: number | null | undefined,
  column: number | null | undefined,
  annualExpenses: number | null | undefined,
) {
  if (profileId == null && column == null && annualExpenses == null)
    return undefined;
  return {
    ...(profileId != null && { profileId }),
    ...(column != null && { column }),
    ...(annualExpenses != null && { annualExpenses }),
  };
}

/** The selection a page sends: only what it picked. */
export function profileSelectionFrom(picks: ProfilePicks): ProfileSelection {
  const accumulationBudget = budgetSource(
    picks.accumulationBudgetProfileId,
    picks.accumulationBudgetColumn,
    picks.accumulationExpenseOverride,
  );
  const decumulationBudget = budgetSource(
    picks.decumulationBudgetProfileId,
    picks.decumulationBudgetColumn,
    picks.decumulationExpenseOverride,
  );
  const { contributionProfileId, salaryProfileId, retirementProfileId } = picks;
  return {
    ...(contributionProfileId != null && {
      contribution: contributionProfileId,
    }),
    ...(salaryProfileId != null && { salary: salaryProfileId }),
    ...(retirementProfileId != null && { retirement: retirementProfileId }),
    ...(accumulationBudget && { accumulationBudget }),
    ...(decumulationBudget && { decumulationBudget }),
  };
}

/** The engine payload's options for a selection; absent stays absent. */
export function engineProfileOptions(selection: ProfileSelection = {}) {
  const acc = selection.accumulationBudget;
  const decumulation = selection.decumulationBudget;
  return {
    contributionProfileId: selection.contribution,
    salaryProfileId: selection.salary,
    retirementProfileId: selection.retirement,
    accumulationBudgetProfileId: acc?.profileId,
    accumulationBudgetColumn: acc?.column,
    accumulationExpenseOverride: acc?.annualExpenses,
    decumulationBudgetProfileId: decumulation?.profileId,
    decumulationBudgetColumn: decumulation?.column,
    decumulationExpenseOverride: decumulation?.annualExpenses,
  };
}
