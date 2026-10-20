"use client";

/**
 * The dashboard's live-plan projection: the engine input every dashboard
 * surface sends (Retirement card, Milestones, Net Worth's FI year), so they
 * all share one React Query entry and one persistent projection-cache row —
 * the cache hashes the full built input, so a near-copy would always miss.
 */
import { trpc } from "@/lib/trpc";
import { useScenario } from "@/lib/context/scenario-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { defaultDecumulationConfig } from "@/lib/config/account-types";
import { projectedFiYear } from "@/lib/pure/milestones";
import { milestoneProjectionYears } from "@/lib/pure/milestone-input";

export function useDashboardEngineInput() {
  // Contribution/Salary Profile axes — every other dashboard card resolves
  // these before querying (this card
  // used to omit both, which the engine treats as "no profile" = $0
  // contributions, not "the active profile" — silently zeroing out
  // Contributions/Coast FIRE/nest egg on this card alone). Each also Plan
  // pin-aware (Plan pin -> globally-active setting), not just the raw
  // global setting, or a Plan pinning a different profile wouldn't move
  // this card.
  const { queryInput: contribProfileInput } = useEffectiveContribProfileId();
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [accBudgetProfileId] = usePersistedSetting<number | null>(
    "retirement_acc_budget_profile_id",
    null,
  );
  const [accBudgetCol] = usePersistedSetting<number | null>(
    "retirement_accumulation_budget_column",
    null,
  );
  const [decBudgetProfileId] = usePersistedSetting<number | null>(
    "retirement_dec_budget_profile_id",
    null,
  );
  const [decBudgetCol] = usePersistedSetting<number | null>(
    "retirement_decumulation_budget_column",
    null,
  );
  const [accExpenseOverride] = usePersistedSetting<string | null>(
    "retirement_acc_expense_override",
    null,
  );
  const [decExpenseOverride] = usePersistedSetting<string | null>(
    "retirement_dec_expense_override",
    null,
  );
  // Must exactly match the Retirement page's own default (un-customized)
  // decumulation form state (use-projection-form-state.ts) — the
  // deterministic computeProjection query below doesn't care
  // (buildDecumulationDefaults always uses settings.withdrawalRate
  // regardless of client input), but the persistent projection cache
  // hashes the FULL built engine input, so a mismatch here would silently
  // guarantee the peek queries below always miss the page's real cached
  // run, even on default settings. Shared via defaultDecumulationConfig()
  // (account-types.ts) so the two call sites can't independently drift.
  const decumulationDefaults = defaultDecumulationConfig();
  const engineInput = {
    ...contribProfileInput,
    ...salaryProfileInput,
    decumulationDefaults,
    ...(accBudgetProfileId != null
      ? { accumulationBudgetProfileId: accBudgetProfileId }
      : {}),
    ...(accBudgetCol != null ? { accumulationBudgetColumn: accBudgetCol } : {}),
    ...(decBudgetProfileId != null
      ? { decumulationBudgetProfileId: decBudgetProfileId }
      : {}),
    ...(decBudgetCol != null ? { decumulationBudgetColumn: decBudgetCol } : {}),
    ...(accExpenseOverride
      ? { accumulationExpenseOverride: parseFloat(accExpenseOverride) }
      : {}),
    ...(decExpenseOverride
      ? { decumulationExpenseOverride: parseFloat(decExpenseOverride) }
      : {}),
  };
  return engineInput;
}

export function useDashboardProjection() {
  const engineInput = useDashboardEngineInput();
  const query = trpc.projection.computeProjection.useQuery(engineInput);
  return { engineInput, ...query };
}

/**
 * When the live plan reaches the FI number — the Milestones engine's
 * projectedFiYear over the dashboard projection, with today's cash held flat
 * (FI progress counts investments + cash). `fi` is null when the projection
 * never gets there; `hasProjection` is false until one exists.
 */
export function useProjectedFiYear(fiTargetToday: number, cashToday: number) {
  const { data, isLoading } = useDashboardProjection();
  const { isInScenario } = useScenario();
  if (!data?.result)
    return {
      isLoading,
      hasProjection: false,
      isScenario: isInScenario,
      fi: null,
    } as const;
  const years = milestoneProjectionYears(
    data.result.projectionByYear,
    cashToday,
  );
  return {
    isLoading,
    hasProjection: true,
    isScenario: isInScenario,
    fi: projectedFiYear(
      years,
      fiTargetToday,
      Number(data.settings.annualInflation) || 0,
      new Date().getFullYear(),
    ),
  } as const;
}
