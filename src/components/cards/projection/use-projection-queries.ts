/** Data fetching and mutations for the projection card — deterministic engine query, Monte Carlo queries with prefetch, salary/budget override CRUD, and glide-path mutations. */
import { useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { MonteCarloPercentileBand } from "@/lib/calculators/types";
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
  const sharedInput = useMemo(
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
  const invalidateMc = () =>
    utils.projection.computeMonteCarloProjection.invalidate();
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
  const mcPrefetchQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      numTrials: 1000,
      preset: "default" as const,
      taxMode: mcTaxMode,
      ...debouncedInput,
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
      ...debouncedInput,
    },
    {
      enabled:
        projectionMode === "monteCarlo" &&
        engineQuery.isSuccess &&
        !engineQuery.isFetching,
      placeholderData: undefined,
    },
  );

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

  const mcLoading =
    projectionMode === "monteCarlo" &&
    (mcQuery.isLoading || mcQuery.isFetching);

  const mcBandsByYear = useMemo(() => {
    if (projectionMode === "monteCarlo" && mcQuery.isFetching) return null;
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
  ]);

  const mcIsPrefetch =
    projectionMode !== "monteCarlo" || !mcQuery.data?.result?.percentileBands;

  const mcChartPending =
    mcLoading || (!mcBandsByYear && mcPrefetchQuery.isFetching);

  const mcDetByYear = useMemo(() => {
    if (projectionMode === "monteCarlo" && mcQuery.isFetching) return null;
    const mcDet =
      projectionMode === "monteCarlo"
        ? mcQuery.data?.result?.deterministicProjection
        : null;
    const det =
      mcDet ?? mcPrefetchQuery.data?.result?.deterministicProjection ?? null;
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
  ]);

  // Contribution profiles query
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();

  return {
    withdrawalRate,
    sharedInput,
    debouncedInput,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    mcLoading,
    mcBandsByYear,
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
