/** Data fetching and mutations for the projection card — deterministic engine query, Monte Carlo queries with prefetch, salary/budget override CRUD, and glide-path mutations. */
import { useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type {
  MonteCarloPercentileBand,
  MonteCarloResult,
} from "@/lib/calculators/types";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { UseProjectionStateProps } from "./use-projection-state";
import { filterYearByParentCategory } from "./utils";

export function useProjectionQueries(
  form: ProjectionFormState,
  props: UseProjectionStateProps,
) {
  const salaryOverrides = useSalaryOverrides();
  const {
    withdrawalRoutingMode,
    withdrawalOrder,
    withdrawalSplits,
    withdrawalTaxPref,
    accumOverrides,
    decumOverrides,
    projectionMode,
    mcTrials,
    mcPreset,
    mcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    scenarioView,
  } = form;

  const {
    withdrawalRate: withdrawalRateProp,
    accumulationBudgetProfileId,
    accumulationBudgetColumn,
    accumulationExpenseOverride,
    decumulationBudgetProfileId,
    decumulationBudgetColumn,
    decumulationExpenseOverride,
    contributionProfileId,
    snapshotId,
    parentCategoryFilter,
  } = props;

  const withdrawalRate = withdrawalRateProp;

  // --- Debounced query inputs ---
  // baseSharedInput is the projection input WITHOUT the Coast FIRE override.
  // Used by the Coast FIRE query itself (so it computes the baseline age)
  // and as the foundation for sharedInput below.
  const baseSharedInput = useMemo(
    () => ({
      salaryOverrides: salaryOverrides.length > 0 ? salaryOverrides : undefined,
      decumulationDefaults: {
        withdrawalRate: withdrawalRate / 100,
        withdrawalRoutingMode,
        withdrawalOrder,
        withdrawalSplits,
        withdrawalTaxPreference: withdrawalTaxPref,
      },
      accumulationOverrides: accumOverrides,
      decumulationOverrides: decumOverrides,
      ...(accumulationBudgetProfileId != null
        ? { accumulationBudgetProfileId }
        : {}),
      ...(accumulationBudgetColumn != null ? { accumulationBudgetColumn } : {}),
      ...(accumulationExpenseOverride != null
        ? { accumulationExpenseOverride }
        : {}),
      ...(decumulationBudgetProfileId != null
        ? { decumulationBudgetProfileId }
        : {}),
      ...(decumulationBudgetColumn != null ? { decumulationBudgetColumn } : {}),
      ...(decumulationExpenseOverride != null
        ? { decumulationExpenseOverride }
        : {}),
      ...(contributionProfileId != null ? { contributionProfileId } : {}),
      ...(snapshotId != null ? { snapshotId } : {}),
    }),
    [
      salaryOverrides,
      withdrawalRate,
      withdrawalRoutingMode,
      withdrawalOrder,
      withdrawalSplits,
      withdrawalTaxPref,
      accumOverrides,
      decumOverrides,
      accumulationBudgetProfileId,
      accumulationBudgetColumn,
      accumulationExpenseOverride,
      decumulationBudgetProfileId,
      decumulationBudgetColumn,
      decumulationExpenseOverride,
      contributionProfileId,
      snapshotId,
    ],
  );

  // Coast FIRE query — always fires on baseline input so the age is available
  // regardless of scenario view. Used by the hero KPI Coast FIRE card AND to
  // derive the override age for the scenario toggle.
  const debouncedBaseInput = useDebouncedValue(baseSharedInput, 600);
  const coastFireQuery = trpc.projection.computeCoastFire.useQuery(
    debouncedBaseInput,
    { placeholderData: (prev) => prev, staleTime: 60_000 },
  );
  const coastFireAge = coastFireQuery.data?.result?.coastFireAge ?? null;

  // sharedInput is baseSharedInput + the Coast FIRE override when the user
  // has toggled to the Coast FIRE scenario view. Only set when the age is
  // sharedInput is baseSharedInput as-is. We intentionally do NOT thread
  // coastFireOverrideAge through engineQuery anymore — that caused a visual
  // lag when toggling scenarioView (engineQuery refetches with new input,
  // 600ms debounce + ~500ms fetch, while MC data swaps synchronously). The
  // deterministic coast projection is instead sourced from
  // coastFireMcResult.deterministicProjection at the derived layer, which
  // switches atomically alongside the MC bands.
  const sharedInput = baseSharedInput;
  const debouncedInput = useDebouncedValue(sharedInput, 600);

  // --- tRPC query ---
  const engineQuery = trpc.projection.computeProjection.useQuery(
    debouncedInput,
    { placeholderData: (prev) => prev },
  );

  // --- Mutations ---
  const utils = trpc.useUtils();
  const invalidateEngine = () =>
    utils.projection.computeProjection.invalidate();
  const createSalaryOverride =
    trpc.settings.retirementSalaryOverrides.create.useMutation({
      onSuccess: invalidateEngine,
    });
  const deleteSalaryOverride =
    trpc.settings.retirementSalaryOverrides.delete.useMutation({
      onSuccess: invalidateEngine,
    });
  const createBudgetOverride =
    trpc.settings.retirementBudgetOverrides.create.useMutation({
      onSuccess: invalidateEngine,
    });
  const deleteBudgetOverride =
    trpc.settings.retirementBudgetOverrides.delete.useMutation({
      onSuccess: invalidateEngine,
    });
  const saveProjectionOverrides =
    trpc.settings.projectionOverrides.save.useMutation({
      onSuccess: invalidateEngine,
    });
  const clearProjectionOverrides =
    trpc.settings.projectionOverrides.clear.useMutation({
      onSuccess: invalidateEngine,
    });
  const invalidateMc = () => {
    utils.projection.computeMonteCarloProjection.invalidate();
    utils.projection.computeStrategyComparison.invalidate();
  };
  const updateGlidePath =
    trpc.projection.updateGlidePathAllocations.useMutation({
      onSuccess: invalidateMc,
    });
  const updateInflationRisk = trpc.projection.updateInflationRisk.useMutation({
    onSuccess: invalidateMc,
  });
  const updateClampBounds = trpc.projection.updateClampBounds.useMutation({
    onSuccess: invalidateMc,
  });
  const updateAssetClassOverrides =
    trpc.projection.updateAssetClassOverrides.useMutation({
      onSuccess: invalidateMc,
    });
  const updateInflationOverrides =
    trpc.projection.updateInflationOverrides.useMutation({
      onSuccess: invalidateMc,
    });

  // --- Monte Carlo queries ---
  // mcPrefetchQuery + mcQuery use debouncedBaseInput (never include the Coast
  // FIRE override). Coast FIRE scenario rendering is powered by
  // coastFireMcQuery below — the chart data selectors pick between the two
  // based on scenarioView so switching scenarios doesn't invalidate the
  // baseline MC cache.
  const mcPrefetchQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      numTrials: 1000,
      preset: "default" as const,
      taxMode: mcTaxMode,
      ...debouncedBaseInput,
    },
    {
      enabled: engineQuery.isSuccess && !engineQuery.isFetching,
      placeholderData: (prev) => prev,
    },
  );

  const mcQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      numTrials: mcTrials,
      preset: mcPreset,
      taxMode: mcTaxMode,
      assetClassOverrides:
        mcAssetClassOverrides.length > 0 ? mcAssetClassOverrides : undefined,
      ...debouncedBaseInput,
    },
    {
      enabled:
        projectionMode === "monteCarlo" &&
        engineQuery.isSuccess &&
        !engineQuery.isFetching,
      placeholderData: undefined,
    },
  );

  // Coast FIRE Monte Carlo — prefetched on engineQuery success, same
  // trigger as the baseline mcPrefetchQuery. Runs in the background (~4-6s
  // for the binary search) while the user looks at the baseline view; by
  // the time they toggle to Coast FIRE, the data is already cached and the
  // toggle is instant. Returns binary-search result PLUS the full
  // MonteCarloResult from its final probe (mcResult) so the chart and the
  // hero card can both read from this single query. React Query dedupes on
  // the query key, so any other consumer firing the same procedure with
  // the same input hits the cache.
  //
  // Cost: one additional expensive-rate-limit slot per page load plus
  // ~4-6s of background server CPU. For a self-hosted deployment this is
  // negligible compared to the UX improvement of an instant Coast FIRE
  // toggle.
  const coastFireMcQuery = trpc.projection.computeCoastFireMC.useQuery(
    debouncedBaseInput,
    {
      enabled: engineQuery.isSuccess && !engineQuery.isFetching,
      placeholderData: (prev) => prev,
      staleTime: 5 * 60_000,
    },
  );
  // Cast to MonteCarloResult — tRPC's return-type inference widens the
  // nested mcResult because of the union across the binary-search branches
  // (already_coast / found / unreachable). The calculator authors this field
  // directly from calculateMonteCarlo() so the runtime shape is guaranteed.
  const coastFireMcResult = coastFireMcQuery.data?.result?.mcResult as
    | MonteCarloResult
    | undefined;

  // Initialize asset class overrides from saved DB values on first MC query success
  const mcOverridesInitialized = useRef(false);
  useEffect(() => {
    if (mcOverridesInitialized.current) return;
    const saved =
      mcQuery.data?.savedOverrides ?? mcPrefetchQuery.data?.savedOverrides;
    if (!saved) return;
    mcOverridesInitialized.current = true;
    if (saved.assetClassOverrides && saved.assetClassOverrides.length > 0) {
      setMcAssetClassOverrides(saved.assetClassOverrides);
    }
  }, [
    mcQuery.data?.savedOverrides,
    mcPrefetchQuery.data?.savedOverrides,
    setMcAssetClassOverrides,
  ]);

  // Two separate gates:
  // - inCoastFireScenario: which MC source to LOAD (controls mcLoading etc).
  //   As soon as the user toggles Coast FIRE, we're waiting on coast MC —
  //   the spinner should show even before coastFireMcResult arrives.
  // - useCoastFireMc: which MC source to READ from once data is available
  //   (controls band/detail selectors). Requires coastFireMcResult to exist.
  const inCoastFireScenario = scenarioView === "coastFire";
  const useCoastFireMc = inCoastFireScenario && !!coastFireMcResult;

  const mcLoading =
    projectionMode === "monteCarlo" &&
    (inCoastFireScenario
      ? coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
      : mcQuery.isLoading || mcQuery.isFetching);

  const mcBandsByYear = useMemo(() => {
    if (projectionMode === "monteCarlo" && mcQuery.isFetching) return null;
    if (useCoastFireMc) {
      const bands = coastFireMcResult?.percentileBands ?? null;
      if (!bands) return null;
      return new Map<number, MonteCarloPercentileBand>(
        bands.map((b) => [b.year, b]),
      );
    }
    const mcBands =
      projectionMode === "monteCarlo"
        ? mcQuery.data?.result?.percentileBands
        : null;
    const bands =
      mcBands ?? mcPrefetchQuery.data?.result?.percentileBands ?? null;
    if (!bands) return null;
    return new Map<number, MonteCarloPercentileBand>(
      bands.map((b) => [b.year, b]),
    );
  }, [
    projectionMode,
    mcQuery.isFetching,
    mcQuery.data?.result?.percentileBands,
    mcPrefetchQuery.data?.result?.percentileBands,
    useCoastFireMc,
    coastFireMcResult?.percentileBands,
  ]);

  const mcStabilityBands = useMemo(() => {
    if (projectionMode === "monteCarlo" && mcQuery.isFetching) return null;
    const bands = useCoastFireMc
      ? (coastFireMcResult?.spendingStabilityBands ?? null)
      : ((projectionMode === "monteCarlo"
          ? mcQuery.data?.result?.spendingStabilityBands
          : null) ??
        mcPrefetchQuery.data?.result?.spendingStabilityBands ??
        null);
    if (!bands) return null;
    return {
      stratRatio: new Map(bands.stratRatio.map((b) => [b.age, b])),
      budgetRatio: bands.budgetRatio
        ? new Map(bands.budgetRatio.map((b) => [b.age, b]))
        : null,
    };
  }, [
    projectionMode,
    mcQuery.isFetching,
    mcQuery.data?.result?.spendingStabilityBands,
    mcPrefetchQuery.data?.result?.spendingStabilityBands,
    useCoastFireMc,
    coastFireMcResult?.spendingStabilityBands,
  ]);

  const mcIsPrefetch =
    projectionMode !== "monteCarlo" || !mcQuery.data?.result?.percentileBands;

  const mcChartPending =
    mcLoading || (!mcBandsByYear && mcPrefetchQuery.isFetching);

  const mcDetByYear = useMemo(() => {
    if (projectionMode === "monteCarlo" && mcQuery.isFetching) return null;
    const det = useCoastFireMc
      ? (coastFireMcResult?.deterministicProjection ?? null)
      : ((projectionMode === "monteCarlo"
          ? mcQuery.data?.result?.deterministicProjection
          : null) ??
        mcPrefetchQuery.data?.result?.deterministicProjection ??
        null);
    if (!det) return null;
    return new Map(
      det.projectionByYear.map((y) => {
        const yr = parentCategoryFilter
          ? filterYearByParentCategory(y, parentCategoryFilter)
          : y;
        return [y.year, yr] as const;
      }),
    );
  }, [
    projectionMode,
    mcQuery.isFetching,
    mcQuery.data?.result?.deterministicProjection,
    mcPrefetchQuery.data?.result?.deterministicProjection,
    parentCategoryFilter,
    useCoastFireMc,
    coastFireMcResult?.deterministicProjection,
  ]);

  // Contribution profiles query
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();

  return {
    withdrawalRate,
    sharedInput,
    debouncedInput,
    debouncedBaseInput,
    coastFireQuery,
    coastFireAge,
    coastFireMcQuery,
    coastFireMcResult,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    mcLoading,
    mcBandsByYear,
    mcStabilityBands,
    mcIsPrefetch,
    mcChartPending,
    mcDetByYear,
    createSalaryOverride,
    deleteSalaryOverride,
    createBudgetOverride,
    deleteBudgetOverride,
    saveProjectionOverrides,
    clearProjectionOverrides,
    updateGlidePath,
    updateInflationRisk,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,
    contribProfilesQuery,
  };
}

export type ProjectionQueries = ReturnType<typeof useProjectionQueries>;
