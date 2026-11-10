/** Data fetching and mutations for the projection card — deterministic engine query, Monte Carlo queries with prefetch, salary/budget override CRUD, and glide-path mutations. */
import { useMemo, useEffect, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useBoundedPollInterval } from "@/components/retirement-projection/use-bounded-poll-interval";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import {
  SK_RETIREMENT_SIMULATION_AUTOLOAD,
  SK_RETIREMENT_MC_AUTOLOAD,
  SK_RETIREMENT_COASTFIRE_SIMULATION_AUTOLOAD,
} from "@/lib/constants/settings-keys";
import {
  PROJECTION_STALE_TIME_MS,
  PROJECTION_DEBOUNCE_MS,
  DEFAULT_SIMULATION,
} from "@/lib/constants";
import type {
  MonteCarloPercentileBand,
  MonteCarloResult,
} from "@/lib/pure/simulation/monte-carlo.types";
import { SIMULATION_NOT_CONFIGURED_MESSAGE } from "@/lib/pure/simulation/monte-carlo";
import { simulationDollars } from "@/lib/pure/simulation/dollars";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { UseProjectionStateProps } from "./use-projection-state.types";
import { filterYearByParentCategory } from "./parent-category-filter";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";

type CoastFireProbeResult = NonNullable<
  RouterOutputs["projection"]["computeCoastFireProbe"]["result"]
>;

// Safety ceiling for every getMonteCarloProgress poller below (400ms
// interval x 450 = ~3 minutes) — see useBoundedPollInterval's own
// docblock for why a poll needs one at all.
const SIMULATION_PROGRESS_POLL_MAX = 450;

export function useProjectionQueries(
  form: ProjectionFormState,
  props: UseProjectionStateProps,
) {
  const {
    withdrawalRoutingMode,
    withdrawalRoutingModeTouched,
    withdrawalOrder,
    withdrawalOrderTouched,
    withdrawalSplits,
    withdrawalSplitsTouched,
    withdrawalTaxPref,
    accumOverrides,
    decumOverrides,
    accumOverridesTouched,
    decumOverridesTouched,
    projectionMode,
    simulationTrials,
    simulationPreset,
    simulationTaxMode,
    simulationAssetClassOverrides,
    setSimulationAssetClassOverrides,
    projectionView,
    coastFireCustomAge,
    dollarMode,
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
    salaryProfileId,
    retirementProfileId,
    snapshotId,
    parentCategoryFilter,
  } = props;

  const withdrawalRate = withdrawalRateProp;

  // --- Debounced query inputs ---
  // baseSharedInput: the projection input without the Coast FIRE override,
  // used by the Coast FIRE query itself and as the base of sharedInput.
  const baseSharedInput = useMemo(
    () => ({
      decumulationDefaults: {
        // Omitted until the user touches the matching Configure editor, so the
        // server resolves the persisted setting and the input matches the
        // dashboard tile's peek query (see the *Touched flags).
        ...(withdrawalRoutingModeTouched ? { withdrawalRoutingMode } : {}),
        ...(withdrawalOrderTouched ? { withdrawalOrder } : {}),
        ...(withdrawalSplitsTouched ? { withdrawalSplits } : {}),
        withdrawalTaxPreference: withdrawalTaxPref,
      },
      // Untouched "Changes by year" are omitted: the server applies the
      // saved rows, so this input is byte-identical to the dashboard's
      // (usePlanEngineInput) and doesn't wait for the rows to load here.
      ...(accumOverridesTouched
        ? { accumulationOverrides: accumOverrides }
        : {}),
      ...(decumOverridesTouched
        ? { decumulationOverrides: decumOverrides }
        : {}),
      // Spread into every engine query in this hook, so the AssumptionsBand's
      // "view a non-active profile" reaches all of them from one place.
      selection: profileSelectionFrom({
        accumulationBudgetProfileId,
        accumulationBudgetColumn,
        accumulationExpenseOverride,
        decumulationBudgetProfileId,
        decumulationBudgetColumn,
        decumulationExpenseOverride,
        contributionProfileId,
        salaryProfileId,
        retirementProfileId,
      }),
      ...(snapshotId != null ? { snapshotId } : {}),
    }),
    [
      withdrawalRoutingMode,
      withdrawalRoutingModeTouched,
      withdrawalOrder,
      withdrawalOrderTouched,
      withdrawalSplits,
      withdrawalSplitsTouched,
      withdrawalTaxPref,
      accumOverrides,
      decumOverrides,
      accumOverridesTouched,
      decumOverridesTouched,
      accumulationBudgetProfileId,
      accumulationBudgetColumn,
      accumulationExpenseOverride,
      decumulationBudgetProfileId,
      decumulationBudgetColumn,
      decumulationExpenseOverride,
      contributionProfileId,
      salaryProfileId,
      retirementProfileId,
      snapshotId,
    ],
  );

  // Coast FIRE query — always fires on baseline input so the age is available
  // regardless of scenario view. Used by the hero KPI Coast FIRE card AND to
  // derive the override age for the scenario toggle.
  const debouncedBaseInput = useDebouncedValue(
    baseSharedInput,
    PROJECTION_DEBOUNCE_MS,
  );
  const coastFireQuery = trpc.projection.computeCoastFire.useQuery(
    debouncedBaseInput,
    { placeholderData: (prev) => prev, staleTime: PROJECTION_STALE_TIME_MS },
  );
  const coastFireAge = coastFireQuery.data?.result?.coastFireAge ?? null;

  // Multi-year bracket-target optimizer (same query as the Taxes settings
  // section), feeding the tooltips and advisor report. Baseline input, and not
  // gated on routing mode: the target also drives conversions and RMD smoothing.
  const bracketOptimizerQuery =
    trpc.projection.computeWithdrawalBracketOptimizer.useQuery(
      debouncedBaseInput,
      { staleTime: 5 * 60 * 1000 },
    );
  const bracketOptimizerResult = bracketOptimizerQuery.data?.result ?? null;

  // sharedInput is baseSharedInput as-is: the Coast FIRE deterministic line
  // comes from coastFireMcResult.deterministicProjection at the derived layer,
  // switching atomically with the MC bands instead of refetching the engine.
  const sharedInput = baseSharedInput;
  const debouncedInput = useDebouncedValue(sharedInput, PROJECTION_DEBOUNCE_MS);

  // --- Autoload settings ---
  const [autoloadEnabled] = usePersistedToggle(
    SK_RETIREMENT_SIMULATION_AUTOLOAD,
    true,
  );
  const [mcAutoloadEnabled] = usePersistedToggle(
    SK_RETIREMENT_MC_AUTOLOAD,
    true,
  );
  // Defaults false: the background Coast FIRE MC probe adds ~4-6s of server
  // work per page load. Turning it on trades that for instant scenario
  // switching (see coastFireMcQuery).
  const [coastFireMcAutoloadEnabled] = usePersistedToggle(
    SK_RETIREMENT_COASTFIRE_SIMULATION_AUTOLOAD,
    false,
  );

  // --- tRPC query ---
  const engineQuery = trpc.projection.computeProjection.useQuery(
    debouncedInput,
    { placeholderData: (prev) => prev, enabled: autoloadEnabled },
  );

  // --- Mutations ---
  const utils = trpc.useUtils();
  // Saved overrides are read server-side by every projection procedure, so a
  // save invalidates all of them, not just computeProjection.
  const invalidateEngine = () => utils.projection.invalidate();
  const createSalaryOverride =
    trpc.retirement.retirementSalaryOverrides.create.useMutation({
      onSuccess: invalidateEngine,
    });
  const deleteSalaryOverride =
    trpc.retirement.retirementSalaryOverrides.delete.useMutation({
      onSuccess: invalidateEngine,
    });
  const createBudgetOverride =
    trpc.retirement.retirementBudgetOverrides.create.useMutation({
      onSuccess: invalidateEngine,
    });
  const deleteBudgetOverride =
    trpc.retirement.retirementBudgetOverrides.delete.useMutation({
      onSuccess: invalidateEngine,
    });
  const saveProjectionOverrides =
    trpc.retirement.projectionOverrides.save.useMutation({
      onSuccess: invalidateEngine,
    });
  const clearProjectionOverrides =
    trpc.retirement.projectionOverrides.clear.useMutation({
      onSuccess: invalidateEngine,
    });
  const invalidateSimulation = () => {
    utils.projection.computeMonteCarloProjection.invalidate();
    utils.projection.computeStrategyComparison.invalidate();
  };
  // The glide path also sets the stock share VPW sizes by — every
  // projection reads it, not just the Simulation.
  const updateGlidePath =
    trpc.projection.updateGlidePathAllocations.useMutation({
      onSuccess: invalidateEngine,
    });
  const updateClampBounds = trpc.projection.updateClampBounds.useMutation({
    onSuccess: invalidateSimulation,
  });
  const updateAssetClassOverrides =
    trpc.projection.updateAssetClassOverrides.useMutation({
      onSuccess: invalidateSimulation,
    });
  const updateInflationOverrides =
    trpc.projection.updateInflationOverrides.useMutation({
      onSuccess: invalidateSimulation,
    });

  // --- Explicit re-run actions ---
  // Fetch with forceRefresh (new seed, bypassing the persistent cache), then
  // write the result under the plain input key so every consumer sees it.
  const runSimulation = async () => {
    const result = await utils.projection.computeProjection.fetch({
      ...debouncedInput,
      forceRefresh: true,
    });
    utils.projection.computeProjection.setData(debouncedInput, result);
  };
  // Must mirror mcQuery's input exactly: a result written under any other key
  // lands where mcQuery never reads, leaving stale data after a "successful" re-run.
  const runMonteCarloInput = useMemo(
    () => ({
      numTrials: simulationTrials,
      preset: simulationPreset,
      taxMode: simulationTaxMode,
      assetClassOverrides:
        simulationAssetClassOverrides.length > 0
          ? simulationAssetClassOverrides
          : undefined,
      ...debouncedBaseInput,
    }),
    [
      simulationTrials,
      simulationPreset,
      simulationTaxMode,
      simulationAssetClassOverrides,
      debouncedBaseInput,
    ],
  );
  // Shared with coastFireMcQuery and its re-run so both poll the same progress
  // entry. Derived from the input (not a per-mount random id) so progress
  // resumes after a remount (see monte-carlo-worker-client.ts runId).
  const coastFireSimulationRunId = useMemo(
    () => JSON.stringify(debouncedBaseInput),
    [debouncedBaseInput],
  );
  const simulationRunId = useMemo(
    () => JSON.stringify(runMonteCarloInput),
    [runMonteCarloInput],
  );
  // Re-runs `.fetch()` with `forceRefresh: true` for a new seed, bypassing the
  // hooks, so *Query.isFetching stays false: consumers must OR in `isRerunning`.
  // Counted, since both re-runs can be in flight at once (Promise.all).
  const [activeSimulationReruns, setActiveSimulationReruns] = useState(0);
  const isRerunning = activeSimulationReruns > 0;
  const runMonteCarlo = async () => {
    setActiveSimulationReruns((n) => n + 1);
    try {
      // Same ids mcQuery / coastFireMcQuery poll progress under (consts below,
      // initialized before any click), so a manual re-run reports live progress.
      const result = await utils.projection.computeMonteCarloProjection.fetch({
        ...runMonteCarloInput,
        runId: simulationRunId,
        forceRefresh: true,
      });
      utils.projection.computeMonteCarloProjection.setData(
        { ...runMonteCarloInput, runId: simulationRunId },
        result,
      );
    } finally {
      setActiveSimulationReruns((n) => n - 1);
    }
  };
  const runCoastFireMc = async () => {
    setActiveSimulationReruns((n) => n + 1);
    try {
      const result = await utils.projection.computeCoastFireMC.fetch({
        ...debouncedBaseInput,
        runId: coastFireSimulationRunId,
        forceRefresh: true,
      });
      utils.projection.computeCoastFireMC.setData(
        { ...debouncedBaseInput, runId: coastFireSimulationRunId },
        result,
      );
    } finally {
      setActiveSimulationReruns((n) => n - 1);
    }
  };
  /** Both baseline MC + Coast FIRE MC together — what the "Re-run" button
   *  actually triggers. */
  const rerunAllMc = async () => {
    await Promise.all([runMonteCarlo(), runCoastFireMc()]);
  };

  // Coast FIRE "Custom Age" probe: explicit-run, since each check is a
  // rate-limited MC run and auto-firing per stepper tick would exhaust the
  // limit. Plain local state; uses the undebounced `baseSharedInput`.
  const [coastFireProbeResult, setCoastFireProbeResult] =
    useState<CoastFireProbeResult | null>(null);
  const [coastFireProbeLoading, setCoastFireProbeLoading] = useState(false);
  const [coastFireProbeError, setCoastFireProbeError] = useState<string | null>(
    null,
  );
  // Set right before each probe fetch, for coastFireProbeProgressQuery. A fresh
  // id per click is fine: the call completes within one button press, with no
  // remount to reconnect.
  const [coastFireProbeRunId, setCoastFireProbeRunId] = useState<string | null>(
    null,
  );
  const checkCoastFireCustomAge = async (probeAge: number) => {
    const runId = crypto.randomUUID();
    setCoastFireProbeRunId(runId);
    setCoastFireProbeLoading(true);
    setCoastFireProbeError(null);
    try {
      const response = await utils.projection.computeCoastFireProbe.fetch({
        ...baseSharedInput,
        probeAge,
        runId,
      });
      setCoastFireProbeResult(response.result);
      // Can't simulate: say why where a failed check would.
      if ("notConfigured" in response)
        setCoastFireProbeError(
          SIMULATION_NOT_CONFIGURED_MESSAGE[response.notConfigured],
        );
    } catch (err) {
      setCoastFireProbeError(
        err instanceof Error ? err.message : "Failed to check this age.",
      );
    } finally {
      setCoastFireProbeLoading(false);
      setCoastFireProbeRunId(null);
    }
  };
  const coastFireProbeProgressEnabled =
    coastFireProbeLoading && coastFireProbeRunId != null;
  const coastFireProbeProgressInterval = useBoundedPollInterval(
    400,
    SIMULATION_PROGRESS_POLL_MAX,
    coastFireProbeProgressEnabled,
    "coastFireProbeProgress",
  );
  const coastFireProbeProgressQuery =
    trpc.projection.getMonteCarloProgress.useQuery(
      { runId: coastFireProbeRunId ?? "" },
      {
        enabled: coastFireProbeProgressEnabled,
        refetchInterval: coastFireProbeProgressInterval,
        staleTime: 0,
      },
    );

  // Operational escape hatch: wipe every cached projection row server-side
  // without a deploy, then invalidate every projection query on this page so
  // it refetches against the now-empty cache at once.
  const clearProjectionCacheMutation = trpc.projection.clearCache.useMutation({
    onSuccess: () => {
      utils.projection.computeProjection.invalidate();
      utils.projection.computeMonteCarloProjection.invalidate();
      utils.projection.computeCoastFire.invalidate();
      utils.projection.computeCoastFireMC.invalidate();
    },
  });

  // --- Monte Carlo queries ---
  // Baseline MC uses debouncedBaseInput (no Coast FIRE override), so switching
  // scenarios keeps its cache. Input-derived runIds let progress survive remounts.
  const simulationPrefetchQueryInput = useMemo(
    () => ({
      numTrials: DEFAULT_SIMULATION.numTrials,
      preset: DEFAULT_SIMULATION.preset,
      taxMode: simulationTaxMode,
      ...debouncedBaseInput,
    }),
    [simulationTaxMode, debouncedBaseInput],
  );
  const simulationPrefetchRunId = useMemo(
    () => JSON.stringify(simulationPrefetchQueryInput),
    [simulationPrefetchQueryInput],
  );
  const mcPrefetchQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    { ...simulationPrefetchQueryInput, runId: simulationPrefetchRunId },
    {
      enabled:
        mcAutoloadEnabled && engineQuery.isSuccess && !engineQuery.isFetching,
      placeholderData: (prev) => prev,
    },
  );
  // Live "N / total trials" for the background prefetch that starts after the
  // engine finishes; simulationProgressQuery tracks the foreground run. See
  // index.tsx's mcProgress for how they merge into one banner.
  const simulationPrefetchProgressInterval = useBoundedPollInterval(
    400,
    SIMULATION_PROGRESS_POLL_MAX,
    mcPrefetchQuery.isFetching,
    "mcPrefetchProgress",
  );
  const simulationPrefetchProgressQuery =
    trpc.projection.getMonteCarloProgress.useQuery(
      { runId: simulationPrefetchRunId },
      {
        enabled: mcPrefetchQuery.isFetching,
        refetchInterval: simulationPrefetchProgressInterval,
        staleTime: 0,
      },
    );

  // Same shape as runMonteCarloInput (must match; see there). simulationRunId
  // derives from it so "same inputs → same runId" across remounts and the
  // progress poll reconnects to the in-flight job (monte-carlo-worker-client.ts).
  const simulationQueryInput = {
    numTrials: simulationTrials,
    preset: simulationPreset,
    taxMode: simulationTaxMode,
    assetClassOverrides:
      simulationAssetClassOverrides.length > 0
        ? simulationAssetClassOverrides
        : undefined,
    ...debouncedBaseInput,
  };
  const mcQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      ...simulationQueryInput,
      runId: simulationRunId,
    },
    {
      enabled:
        mcAutoloadEnabled &&
        projectionMode === "monteCarlo" &&
        engineQuery.isSuccess &&
        !engineQuery.isFetching,
      placeholderData: undefined,
    },
  );
  // Live "N / total trials" for the "recalculating" indicator: polls while
  // mcQuery fetches or a manual re-run (same simulationRunId) is in flight.
  // See monte-carlo-worker-client.ts for why this polls an in-memory map.
  const simulationProgressEnabled = mcQuery.isFetching || isRerunning;
  const simulationProgressInterval = useBoundedPollInterval(
    400,
    SIMULATION_PROGRESS_POLL_MAX,
    simulationProgressEnabled,
    "mcProgress",
  );
  const simulationProgressQuery =
    trpc.projection.getMonteCarloProgress.useQuery(
      { runId: simulationRunId },
      {
        enabled: simulationProgressEnabled,
        refetchInterval: simulationProgressInterval,
        staleTime: 0,
      },
    );

  // Coast FIRE MC runs on demand once a Coast FIRE scenario is selected, or
  // always with `coastFireMcAutoloadEnabled`. Keep in sync with
  // `inCoastFireScenario` below; exposed for index.tsx's progress-strip phase.
  const coastFireSimulationQueryEnabled =
    coastFireMcAutoloadEnabled ||
    projectionView === "coastFire" ||
    projectionView === "coastFireToday";
  const coastFireMcQuery = trpc.projection.computeCoastFireMC.useQuery(
    { ...debouncedBaseInput, runId: coastFireSimulationRunId },
    {
      enabled:
        coastFireSimulationQueryEnabled &&
        engineQuery.isSuccess &&
        !engineQuery.isFetching,
      placeholderData: (prev) => prev,
      staleTime: 5 * PROJECTION_STALE_TIME_MS,
    },
  );
  // Live progress of the Coast FIRE binary search's current probe (resets to 0
  // per probe); also polls during a manual re-run, which reuses
  // coastFireSimulationRunId.
  const coastFireSimulationProgressEnabled =
    coastFireMcQuery.isFetching || isRerunning;
  const coastFireSimulationProgressInterval = useBoundedPollInterval(
    400,
    SIMULATION_PROGRESS_POLL_MAX,
    coastFireSimulationProgressEnabled,
    "coastFireMcProgress",
  );
  const coastFireSimulationProgressQuery =
    trpc.projection.getMonteCarloProgress.useQuery(
      { runId: coastFireSimulationRunId },
      {
        enabled: coastFireSimulationProgressEnabled,
        refetchInterval: coastFireSimulationProgressInterval,
        staleTime: 0,
      },
    );
  // Cast: tRPC widens the nested mcResult across the binary-search branches;
  // the calculator authors it directly from calculateMonteCarlo().
  const coastFireMcResult = coastFireMcQuery.data?.result?.mcResult as
    MonteCarloResult | undefined;
  // "Coast FIRE (Today)": contributions stop at the CURRENT age; the router
  // returns it as `stopNowMcResult`. Null under already_coast, where mcResult
  // already covers "today", so fall back to it.
  const coastFireTodayMcResult = (
    coastFireMcQuery.data?.result?.status === "already_coast"
      ? coastFireMcQuery.data.result.mcResult
      : coastFireMcQuery.data?.result?.stopNowMcResult
  ) as MonteCarloResult | undefined;

  // Rate-Seeded scenario: computeMonteCarloProjection with the
  // rateSeededDecumulationYear1 flag (full MonteCarloResult incl.
  // deterministicProjection). On demand only, once the scenario is selected.
  const rateSeededSimulationQueryInput = useMemo(
    () => ({
      numTrials: DEFAULT_SIMULATION.numTrials,
      preset: DEFAULT_SIMULATION.preset,
      taxMode: simulationTaxMode,
      ...debouncedBaseInput,
      rateSeededDecumulationYear1: true,
    }),
    [simulationTaxMode, debouncedBaseInput],
  );
  const rateSeededSimulationRunId = useMemo(
    () => JSON.stringify(rateSeededSimulationQueryInput),
    [rateSeededSimulationQueryInput],
  );
  const rateSeededMcQuery =
    trpc.projection.computeMonteCarloProjection.useQuery(
      { ...rateSeededSimulationQueryInput, runId: rateSeededSimulationRunId },
      {
        enabled:
          projectionView === "rateSeeded" &&
          engineQuery.isSuccess &&
          !engineQuery.isFetching,
        placeholderData: (prev) => prev,
        staleTime: 5 * PROJECTION_STALE_TIME_MS,
      },
    );
  const rateSeededSimulationResult = rateSeededMcQuery.data?.result as
    MonteCarloResult | undefined;
  // No manual "Re-run" action exists for this scenario (unlike mc/coast
  // fire above) — only the steady-state query itself, so this doesn't
  // need an `isRerunning` OR'd into its enabled condition.
  const rateSeededSimulationProgressInterval = useBoundedPollInterval(
    400,
    SIMULATION_PROGRESS_POLL_MAX,
    rateSeededMcQuery.isFetching,
    "rateSeededMcProgress",
  );
  const rateSeededSimulationProgressQuery =
    trpc.projection.getMonteCarloProgress.useQuery(
      { runId: rateSeededSimulationRunId },
      {
        enabled: rateSeededMcQuery.isFetching,
        refetchInterval: rateSeededSimulationProgressInterval,
        staleTime: 0,
      },
    );

  // Initialize asset class overrides from saved DB values on first MC query success
  const simulationOverridesInitialized = useRef(false);
  useEffect(() => {
    if (simulationOverridesInitialized.current) return;
    const saved =
      mcQuery.data?.savedOverrides ?? mcPrefetchQuery.data?.savedOverrides;
    if (!saved) return;
    simulationOverridesInitialized.current = true;
    if (saved.assetClassOverrides.length > 0) {
      setSimulationAssetClassOverrides(saved.assetClassOverrides);
    }
  }, [
    mcQuery.data?.savedOverrides,
    mcPrefetchQuery.data?.savedOverrides,
    setSimulationAssetClassOverrides,
  ]);

  // inCoastFireScenario: which MC source to LOAD (spinner shows before data);
  // useCoastFireSimulation: which to READ once the active result exists. Both
  // variants' results come from the same coastFireMcQuery response.
  const inCoastFireScenario =
    projectionView === "coastFire" || projectionView === "coastFireToday";
  const activeCoastFireSimulationResult =
    projectionView === "coastFireToday"
      ? coastFireTodayMcResult
      : coastFireMcResult;
  // Which non-baseline scenario, if any, is active: Coast FIRE (all variants)
  // and Rate-Seeded source their deterministic line + MC bands from their own
  // MonteCarloResult (Custom's is plain state; see checkCoastFireCustomAge).
  const inAltScenario =
    inCoastFireScenario ||
    projectionView === "rateSeeded" ||
    projectionView === "coastFireCustom";
  const activeAltMcResult =
    projectionView === "rateSeeded"
      ? rateSeededSimulationResult
      : projectionView === "coastFireCustom"
        ? // Only the probe for the committed age: an older probe's bands would
          // show the wrong scenario with no loading indicator (same
          // probeAge === committedAge check as the pass/fail label in index.tsx).
          coastFireProbeResult?.probeAge === coastFireCustomAge
          ? coastFireProbeResult.mcResult
          : undefined
        : activeCoastFireSimulationResult;
  const useCoastFireSimulation = inAltScenario && !!activeAltMcResult;

  const simulationLoading =
    projectionMode === "monteCarlo" &&
    (isRerunning ||
      (projectionView === "rateSeeded"
        ? rateSeededMcQuery.isLoading || rateSeededMcQuery.isFetching
        : projectionView === "coastFireCustom"
          ? coastFireProbeLoading
          : inCoastFireScenario
            ? coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
            : mcQuery.isLoading || mcQuery.isFetching));

  const simulationBandsByYear = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireSimulation
    )
      return null;
    // In the dollars the chart shows — today's come from the Simulation,
    // each trial deflated by its own inflation (never re-deflated here).
    const source = useCoastFireSimulation
      ? activeAltMcResult
      : ((projectionMode === "monteCarlo" ? mcQuery.data?.result : null) ??
        mcPrefetchQuery.data?.result);
    if (!source) return null;
    return new Map<number, MonteCarloPercentileBand>(
      simulationDollars(source, dollarMode).percentileBands.map((b) => [
        b.year,
        b,
      ]),
    );
  }, [
    projectionMode,
    mcQuery.isFetching,
    mcQuery.data?.result,
    mcPrefetchQuery.data?.result,
    useCoastFireSimulation,
    activeAltMcResult,
    dollarMode,
  ]);

  const simulationStabilityBands = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireSimulation
    )
      return null;
    const bands = useCoastFireSimulation
      ? activeAltMcResult.spendingStabilityBands
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
    useCoastFireSimulation,
    activeAltMcResult,
  ]);

  const simulationIsPrefetch =
    projectionMode !== "monteCarlo" || !mcQuery.data?.result?.percentileBands;

  const mcChartPending =
    simulationLoading || (!simulationBandsByYear && mcPrefetchQuery.isFetching);

  const simulationDetByYear = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireSimulation
    )
      return null;
    const det = useCoastFireSimulation
      ? activeAltMcResult.deterministicProjection
      : ((projectionMode === "monteCarlo"
          ? mcQuery.data?.result?.deterministicProjection
          : null) ??
        mcPrefetchQuery.data?.result?.deterministicProjection ??
        null);
    if (!det) return null;
    return new Map(
      det.projectionByYear.map((y) => {
        const yearRow = parentCategoryFilter
          ? filterYearByParentCategory(y, parentCategoryFilter)
          : y;
        return [y.year, yearRow] as const;
      }),
    );
  }, [
    projectionMode,
    mcQuery.isFetching,
    mcQuery.data?.result?.deterministicProjection,
    mcPrefetchQuery.data?.result?.deterministicProjection,
    parentCategoryFilter,
    useCoastFireSimulation,
    activeAltMcResult,
  ]);

  // Contribution profiles query
  const contributionProfilesQuery = trpc.contributionProfile.list.useQuery();
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();

  return {
    withdrawalRate,
    sharedInput,
    debouncedInput,
    debouncedBaseInput,
    coastFireQuery,
    coastFireAge,
    bracketOptimizerQuery,
    bracketOptimizerResult,
    coastFireMcQuery,
    coastFireSimulationQueryEnabled,
    simulationProgressQuery,
    simulationPrefetchProgressQuery,
    coastFireSimulationProgressQuery,
    rateSeededSimulationProgressQuery,
    coastFireProbeProgressQuery,
    coastFireMcResult,
    coastFireTodayMcResult,
    activeCoastFireSimulationResult,
    rateSeededMcQuery,
    rateSeededSimulationResult,
    coastFireProbeResult,
    coastFireProbeLoading,
    coastFireProbeError,
    checkCoastFireCustomAge,
    activeAltMcResult,
    autoloadEnabled,
    runSimulation,
    mcAutoloadEnabled,
    runMonteCarlo,
    coastFireMcAutoloadEnabled,
    runCoastFireMc,
    rerunAllMc,
    isRerunning,
    clearProjectionCacheMutation,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    simulationLoading,
    simulationBandsByYear,
    simulationStabilityBands,
    simulationIsPrefetch,
    mcChartPending,
    simulationDetByYear,
    createSalaryOverride,
    deleteSalaryOverride,
    createBudgetOverride,
    deleteBudgetOverride,
    saveProjectionOverrides,
    clearProjectionOverrides,
    updateGlidePath,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,
    contributionProfilesQuery,
    salaryProfilesQuery,
  };
}

export type ProjectionQueries = ReturnType<typeof useProjectionQueries>;
