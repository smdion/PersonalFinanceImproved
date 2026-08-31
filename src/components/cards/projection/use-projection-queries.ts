/** Data fetching and mutations for the projection card — deterministic engine query, Monte Carlo queries with prefetch, salary/budget override CRUD, and glide-path mutations. */
import { useMemo, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import {
  SK_RETIREMENT_SIMULATION_AUTOLOAD,
  SK_RETIREMENT_MC_AUTOLOAD,
  SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
} from "@/lib/constants/settings-keys";
import {
  PROJECTION_STALE_TIME_MS,
  PROJECTION_DEBOUNCE_MS,
  MC_DEFAULT_TRIALS,
} from "@/lib/constants";
import type {
  MonteCarloPercentileBand,
  MonteCarloResult,
} from "@/lib/calculators/types";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { UseProjectionStateProps } from "./use-projection-state";
import { filterYearByParentCategory } from "./utils";

/** Mirrors the server's `CoastFireProbeResult`
 *  (server/routers/projection/coast-fire-probe.ts) — hand-rolled, not
 *  imported, since src/components/** is lint-forbidden from importing
 *  @/server/* (no-restricted-imports rule, eslint.config.mjs; same
 *  reasoning as projection/sections/types.ts's own docblock). */
type CoastFireProbeResult = {
  probeAge: number;
  successRate: number;
  passes: boolean;
  spendingStabilityRate: number;
  penaltyAvoidedShortfallRate: number;
  medianPenaltyAvoidedShortfallPV: number;
  confidenceThreshold: number;
  mcResult: MonteCarloResult;
};

export function useProjectionQueries(
  form: ProjectionFormState,
  props: UseProjectionStateProps,
) {
  const salaryActiveFields = useActiveSalaries();
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
    salaryProfileId,
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
      salaryActiveFields:
        salaryActiveFields.length > 0 ? salaryActiveFields : undefined,
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
      ...(salaryProfileId != null ? { salaryProfileId } : {}),
      ...(snapshotId != null ? { snapshotId } : {}),
    }),
    [
      salaryActiveFields,
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
      salaryProfileId,
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
  // Default flipped false 2026-08-30 (live-user finding: the eager
  // background Coast FIRE MC probe was adding ~4-6s of server work to
  // EVERY projection page load, whether or not the household ever looks
  // at Coast FIRE) — see coastFireMcQuery's docblock below for the new
  // default behavior. Flipping this setting back on restores the old
  // "always prefetched in the background" experience for anyone who
  // prefers instant scenario switching over a faster initial load.
  const [coastFireMcAutoloadEnabled] = usePersistedToggle(
    SK_RETIREMENT_COASTFIRE_MC_AUTOLOAD,
    false,
  );

  // --- tRPC query ---
  const engineQuery = trpc.projection.computeProjection.useQuery(
    debouncedInput,
    { placeholderData: (prev) => prev, enabled: autoloadEnabled },
  );

  // --- Mutations ---
  const utils = trpc.useUtils();
  const invalidateEngine = () =>
    utils.projection.computeProjection.invalidate();
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

  // --- Explicit re-run actions ---
  // A plain refetch() would re-request with the SAME input, which now hits
  // the persistent cache and returns the same (possibly stale-feeling)
  // seed/result. These instead fetch with forceRefresh so the server mints
  // a new seed and recomputes, then write that result into the query cache
  // at the plain (non-forceRefresh) input key so every consumer watching
  // the normal query sees the fresh data immediately.
  const runSimulation = async () => {
    const result = await utils.projection.computeProjection.fetch({
      ...debouncedInput,
      forceRefresh: true,
    });
    utils.projection.computeProjection.setData(debouncedInput, result);
  };
  // Must mirror mcQuery's own input exactly — a fresh result written under
  // any other key (e.g. the trial-count/preset DEFAULTS) lands somewhere
  // mcQuery never reads from, so the UI keeps showing stale data while the
  // "re-run succeeded" toast still fires. Invisible whenever the user
  // hasn't customized MC assumptions, since the defaults and mcQuery's
  // input coincide at their initial values — that's why this went unnoticed.
  const runMonteCarloInput = {
    numTrials: mcTrials,
    preset: mcPreset,
    taxMode: mcTaxMode,
    assetClassOverrides:
      mcAssetClassOverrides.length > 0 ? mcAssetClassOverrides : undefined,
    ...debouncedBaseInput,
  };
  // `runMonteCarlo`/`runCoastFireMc` use an imperative `.fetch()` (not
  // `mcQuery.refetch()`/`.invalidate()`) specifically to pass
  // `forceRefresh: true` — a field that only exists on this one-off call,
  // not on the hook's own steady-state input — so the fetch bypasses the
  // cache and gets a genuinely new random seed, then writes the result
  // back under the hook's real key via `.setData()`. Trade-off: because
  // this bypasses the `useQuery` hook entirely, `mcQuery.isFetching` /
  // `coastFireMcQuery.isFetching` never flip true during this call, so
  // nothing driven by them (the top-of-page "recalculating" banner, the
  // chart/table loading skeleton) showed anything during a manual Re-run —
  // found live 2026-08-30. `isRerunning` is the explicit stand-in signal
  // for exactly that gap; every consumer that reads *Query.isFetching for
  // "is MC busy" must OR this in too (see mcLoading below and
  // index.tsx's isRecalculating).
  // Counted, not a plain boolean — runMonteCarlo/runCoastFireMc can run
  // concurrently (the "Re-run" button fires both via Promise.all), and a
  // shared boolean would get clipped false by whichever one finishes
  // first while the other is still running. A count only reaches 0 once
  // every in-flight run has actually finished.
  const [activeMcReruns, setActiveMcReruns] = useState(0);
  const isRerunning = activeMcReruns > 0;
  const runMonteCarlo = async () => {
    setActiveMcReruns((n) => n + 1);
    try {
      const result = await utils.projection.computeMonteCarloProjection.fetch({
        ...runMonteCarloInput,
        forceRefresh: true,
      });
      utils.projection.computeMonteCarloProjection.setData(
        runMonteCarloInput,
        result,
      );
    } finally {
      setActiveMcReruns((n) => n - 1);
    }
  };
  const runCoastFireMc = async () => {
    setActiveMcReruns((n) => n + 1);
    try {
      const result = await utils.projection.computeCoastFireMC.fetch({
        ...debouncedBaseInput,
        forceRefresh: true,
      });
      utils.projection.computeCoastFireMC.setData(debouncedBaseInput, result);
    } finally {
      setActiveMcReruns((n) => n - 1);
    }
  };
  /** Both baseline MC + Coast FIRE MC together — what the "Re-run" button
   *  actually triggers. */
  const rerunAllMc = async () => {
    await Promise.all([runMonteCarlo(), runCoastFireMc()]);
  };

  // Coast FIRE "Custom Age" probe (advisor-reviewed 2026-08-30, see
  // .scratch/docs/plans/PLAN-coast-fire-custom-age.md) — deliberately
  // EXPLICIT-run, not a `useQuery` with a debounced `enabled`. Every
  // check is a real, rate-limited MC run; auto-firing on every
  // stepper/debounce tick would let deliberate exploration (checking 6+
  // ages in a session, which debounce does nothing to prevent) exhaust
  // the shared expensive-rate-limit bucket and produce a silently
  // half-populated pill instead of the clean, expected "you hit the
  // limit" error this button-driven version produces instead. Plain
  // local state, not a query cache entry -- there's no reactive query
  // whose cache this needs to stay in sync with. `baseSharedInput` (not
  // the debounced variant) since a button press is already the
  // deliberate, one-shot moment debouncing exists to approximate.
  const [coastFireProbeResult, setCoastFireProbeResult] =
    useState<CoastFireProbeResult | null>(null);
  const [coastFireProbeLoading, setCoastFireProbeLoading] = useState(false);
  const [coastFireProbeError, setCoastFireProbeError] = useState<string | null>(
    null,
  );
  const checkCoastFireCustomAge = async (probeAge: number) => {
    setCoastFireProbeLoading(true);
    setCoastFireProbeError(null);
    try {
      const response = await utils.projection.computeCoastFireProbe.fetch({
        ...baseSharedInput,
        probeAge,
      });
      setCoastFireProbeResult(response.result as CoastFireProbeResult | null);
    } catch (err) {
      setCoastFireProbeError(
        err instanceof Error ? err.message : "Failed to check this age.",
      );
    } finally {
      setCoastFireProbeLoading(false);
    }
  };

  // Operational escape hatch (user request, 2026-08-28): wipe every cached
  // projection row server-side without bumping PROJECTION_CACHE_ENGINE_VERSION
  // and redeploying, then invalidate every projection query on THIS page so
  // it refetches against the now-empty cache immediately, rather than
  // requiring a manual reload.
  const clearProjectionCacheMutation = trpc.projection.clearCache.useMutation({
    onSuccess: () => {
      utils.projection.computeProjection.invalidate();
      utils.projection.computeMonteCarloProjection.invalidate();
      utils.projection.computeCoastFire.invalidate();
      utils.projection.computeCoastFireMC.invalidate();
    },
  });

  // --- Monte Carlo queries ---
  // mcPrefetchQuery + mcQuery use debouncedBaseInput (never include the Coast
  // FIRE override). Coast FIRE scenario rendering is powered by
  // coastFireMcQuery below — the chart data selectors pick between the two
  // based on scenarioView so switching scenarios doesn't invalidate the
  // baseline MC cache.
  const mcPrefetchQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      numTrials: MC_DEFAULT_TRIALS,
      preset: "default" as const,
      taxMode: mcTaxMode,
      ...debouncedBaseInput,
    },
    {
      enabled:
        mcAutoloadEnabled && engineQuery.isSuccess && !engineQuery.isFetching,
      placeholderData: (prev) => prev,
    },
  );

  // Stable for this hook instance's whole lifetime, reused across every
  // mcQuery fetch (fetches never overlap for one hook instance — TanStack
  // Query supersedes/cancels the prior one), so the server-side progress
  // map entry naturally gets recreated fresh under the same key each run
  // and cleared on completion. See monte-carlo-worker-client.ts.
  //
  // Derived from the query's own input (not a random id generated once per
  // mount) — a `useState(() => crypto.randomUUID())` regenerates on every
  // fresh mount of this hook, including navigating away from the page and
  // back while the SAME run is still in flight server-side. TanStack
  // Query's query cache is a single app-wide instance (providers.tsx) that
  // survives client-side navigation, so the newly-mounted mcQuery hook
  // correctly re-subscribes to the same in-flight request when the input
  // is unchanged — but a fresh random runId wouldn't match the worker's
  // actual in-progress job id, so progress would silently reset to the
  // plain indeterminate state on return instead of resuming the real
  // trial count (live-user finding, 2026-08-30). Deriving the id from the
  // input itself means "same inputs → same runId" across remounts, so the
  // progress poll reconnects to the correct in-flight job. Genuinely new
  // inputs naturally get a new id, matching the new (different) job the
  // server will actually run.
  const mcQueryInput = {
    numTrials: mcTrials,
    preset: mcPreset,
    taxMode: mcTaxMode,
    assetClassOverrides:
      mcAssetClassOverrides.length > 0 ? mcAssetClassOverrides : undefined,
    ...debouncedBaseInput,
  };
  // Plain derivation, not useMemo — JSON.stringify of this small object is
  // cheap, and the "memoize the input to memoize the output" pattern would
  // just add a second JSON.stringify (for the dependency array) with no
  // benefit, since equal input still produces an equal string either way.
  const mcRunId = JSON.stringify(mcQueryInput);
  const mcQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      ...mcQueryInput,
      runId: mcRunId,
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
  // Live "N / total trials" for the "recalculating" indicator (index.tsx) —
  // only polls while mcQuery is actually in flight. See
  // monte-carlo-worker-client.ts's module docblock for why this is a
  // lightweight poll against an in-memory map rather than a subscription.
  const mcProgressQuery = trpc.projection.getMonteCarloProgress.useQuery(
    { runId: mcRunId },
    { enabled: mcQuery.isFetching, refetchInterval: 400, staleTime: 0 },
  );

  // Coast FIRE Monte Carlo — on demand by default (2026-08-30), same
  // pattern as rateSeededMcQuery below: fires once the household actually
  // selects a Coast FIRE scenario, not on every page load. The KPI hero
  // card's "basic" Coast FIRE info (the earliest passing age) comes from
  // the cheap deterministic `coastFireQuery` above regardless — this MC
  // probe only adds the sequence-of-returns-verified confidence numbers,
  // which nothing needs until the household is actually looking at this
  // scenario. Returns binary-search result PLUS the full MonteCarloResult
  // from its final probe (mcResult) so the chart and the hero card can
  // both read from this single query. React Query dedupes on the query
  // key, so any other consumer firing the same procedure with the same
  // input hits the cache.
  //
  // `coastFireMcAutoloadEnabled` (default false) is the opt-in escape
  // hatch back to the old always-prefetched behavior (~4-6s of background
  // server CPU on every load, in exchange for an instant scenario toggle)
  // for anyone who wants it — see the setting's own docblock above.
  //
  // IMPORTANT: `inCoastFireScenario` isn't defined yet at this point in
  // the file (it's derived below, after this query, from the same
  // `scenarioView` this reads directly) — keep this condition and that
  // one in sync if either changes.
  const coastFireMcQuery = trpc.projection.computeCoastFireMC.useQuery(
    debouncedBaseInput,
    {
      enabled:
        (coastFireMcAutoloadEnabled ||
          scenarioView === "coastFire" ||
          scenarioView === "coastFireToday") &&
        engineQuery.isSuccess &&
        !engineQuery.isFetching,
      placeholderData: (prev) => prev,
      staleTime: 5 * PROJECTION_STALE_TIME_MS,
    },
  );
  // Cast to MonteCarloResult — tRPC's return-type inference widens the
  // nested mcResult because of the union across the binary-search branches
  // (already_coast / found / unreachable). The calculator authors this field
  // directly from calculateMonteCarlo() so the runtime shape is guaranteed.
  const coastFireMcResult = coastFireMcQuery.data?.result?.mcResult as
    MonteCarloResult | undefined;
  // "Coast FIRE (Today)" scenario -- stopping contributions at the CURRENT
  // age specifically, not the found/passing age above. The router already
  // computes this (`stopNowMcResult`) as part of finding the passing age,
  // so no extra MC run is needed here. When the found answer's own coastAge
  // already IS today (status already_coast), stopNowMcResult is null and
  // mcResult already covers "today" -- fall back to it rather than treating
  // null as "not available yet".
  const coastFireTodayMcResult = (
    coastFireMcQuery.data?.result?.status === "already_coast"
      ? coastFireMcQuery.data?.result?.mcResult
      : coastFireMcQuery.data?.result?.stopNowMcResult
  ) as MonteCarloResult | undefined;

  // Rate-Seeded scenario (Feature B, advisor review 2026-08-28) — reuses
  // computeMonteCarloProjection itself (no bespoke procedure needed, unlike
  // Coast FIRE's binary search) with the new rateSeededDecumulationYear1
  // flag, which calculateMonteCarlo already returns a full MonteCarloResult
  // for (including deterministicProjection) exactly like the baseline mc
  // result. On-demand (enabled only once the scenario is selected), not
  // autoloaded in the background like Coast FIRE — a third always-on MC
  // run per page load was judged not worth the extra background server
  // cost for a scenario most households won't open every visit.
  const rateSeededMcQuery =
    trpc.projection.computeMonteCarloProjection.useQuery(
      {
        numTrials: MC_DEFAULT_TRIALS,
        preset: "default" as const,
        taxMode: mcTaxMode,
        ...debouncedBaseInput,
        rateSeededDecumulationYear1: true,
      },
      {
        enabled:
          scenarioView === "rateSeeded" &&
          engineQuery.isSuccess &&
          !engineQuery.isFetching,
        placeholderData: (prev) => prev,
        staleTime: 5 * PROJECTION_STALE_TIME_MS,
      },
    );
  const rateSeededMcResult = rateSeededMcQuery.data?.result as
    MonteCarloResult | undefined;

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
  //   As soon as the user toggles Coast FIRE (either variant), we're
  //   waiting on coast MC — the spinner should show even before the result
  //   arrives.
  // - useCoastFireMc: which MC source to READ from once data is available
  //   (controls band/detail selectors). Requires the active result to exist.
  // activeCoastFireMcResult picks between the found/passing-age result
  // (scenarioView "coastFire") and the stop-at-current-age result
  // (scenarioView "coastFireToday") — both come from the SAME query
  // (computeCoastFireMC already computes both internally), just different
  // fields of its response.
  const inCoastFireScenario =
    scenarioView === "coastFire" || scenarioView === "coastFireToday";
  const activeCoastFireMcResult =
    scenarioView === "coastFireToday"
      ? coastFireTodayMcResult
      : coastFireMcResult;
  // Generalized "which non-baseline scenario, if any, is active" — Coast
  // FIRE (either variant), Coast FIRE Custom, and Rate-Seeded all source
  // their deterministic line + MC bands from their own MonteCarloResult
  // rather than the baseline mcQuery/mcPrefetchQuery, exactly the same
  // selection shape, just a different source behind it (Custom's is
  // plain state, not a query — see checkCoastFireCustomAge above).
  const inAltScenario =
    inCoastFireScenario ||
    scenarioView === "rateSeeded" ||
    scenarioView === "coastFireCustom";
  const activeAltMcResult =
    scenarioView === "rateSeeded"
      ? rateSeededMcResult
      : scenarioView === "coastFireCustom"
        ? coastFireProbeResult?.mcResult
        : activeCoastFireMcResult;
  const useCoastFireMc = inAltScenario && !!activeAltMcResult;

  const mcLoading =
    projectionMode === "monteCarlo" &&
    (isRerunning ||
      (scenarioView === "rateSeeded"
        ? rateSeededMcQuery.isLoading || rateSeededMcQuery.isFetching
        : scenarioView === "coastFireCustom"
          ? coastFireProbeLoading
          : inCoastFireScenario
            ? coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
            : mcQuery.isLoading || mcQuery.isFetching));

  const mcBandsByYear = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireMc
    )
      return null;
    if (useCoastFireMc) {
      const bands = activeAltMcResult?.percentileBands ?? null;
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
    activeAltMcResult?.percentileBands,
  ]);

  const mcStabilityBands = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireMc
    )
      return null;
    const bands = useCoastFireMc
      ? (activeAltMcResult?.spendingStabilityBands ?? null)
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
    activeAltMcResult?.spendingStabilityBands,
  ]);

  const mcIsPrefetch =
    projectionMode !== "monteCarlo" || !mcQuery.data?.result?.percentileBands;

  const mcChartPending =
    mcLoading || (!mcBandsByYear && mcPrefetchQuery.isFetching);

  const mcDetByYear = useMemo(() => {
    if (
      projectionMode === "monteCarlo" &&
      mcQuery.isFetching &&
      !useCoastFireMc
    )
      return null;
    const det = useCoastFireMc
      ? (activeAltMcResult?.deterministicProjection ?? null)
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
    activeAltMcResult?.deterministicProjection,
  ]);

  // Contribution profiles query
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();

  return {
    withdrawalRate,
    sharedInput,
    debouncedInput,
    debouncedBaseInput,
    coastFireQuery,
    coastFireAge,
    coastFireMcQuery,
    mcProgressQuery,
    coastFireMcResult,
    coastFireTodayMcResult,
    activeCoastFireMcResult,
    rateSeededMcQuery,
    rateSeededMcResult,
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
    salaryProfilesQuery,
  };
}

export type ProjectionQueries = ReturnType<typeof useProjectionQueries>;
