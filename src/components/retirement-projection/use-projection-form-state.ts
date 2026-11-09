/** Form and UI state for the projection card — withdrawal config, override forms, view toggles, and MC settings. Overrides are loaded from DB on mount. */
import { useSimulationPreset } from "@/lib/hooks/use-simulation-preset";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AccountCategory } from "@/lib/config/account-types";
import type { DollarBasis } from "@/lib/config/enum-values";
import { trpc } from "@/lib/trpc";
import { type AssetClassOverride } from "@/components/retirement-projection/mc-simulation-types";
import {
  defaultDecumulationConfig,
  getDefaultDecumulationOrder,
  DEFAULT_WITHDRAWAL_SPLITS,
} from "@/lib/config/account-types";
import { DEFAULT_WITHDRAWAL_ROUTING_MODE } from "@/lib/config/withdrawal-routing";
import type {
  AccumOverrideForm,
  DecumOverrideForm,
  AccumOverride,
  DecumOverride,
} from "./types";
import { emptyAccumForm, emptyDecumForm } from "./types";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import { SIMULATION_DEFAULT_TRIALS } from "@/lib/constants";
import { SK_DIAG_MODE } from "@/lib/constants/settings-keys";

export function useProjectionFormState() {
  // --- Withdrawal config --- (seeded from defaultDecumulationConfig())
  // Routing mode is sent only once touched; until then the server resolves
  // the persisted `withdrawal_routing_mode`, so the initial value is unused.
  const [withdrawalRoutingMode, setWithdrawalRoutingModeRaw] = useState<
    "bracket_filling" | "waterfall" | "percentage"
  >(DEFAULT_WITHDRAWAL_ROUTING_MODE);
  const [withdrawalRoutingModeTouched, setWithdrawalRoutingModeTouched] =
    useState(false);
  const setWithdrawalRoutingMode = useCallback(
    (v: "bracket_filling" | "waterfall" | "percentage") => {
      setWithdrawalRoutingModeRaw(v);
      setWithdrawalRoutingModeTouched(true);
    },
    [],
  );
  // Touched-gated like `withdrawalRoutingMode`: order/splits are sent only once
  // edited this session; until then the server resolves the persisted
  // `withdrawal_order` / `withdrawal_splits`.
  const [withdrawalOrder, setWithdrawalOrderRaw] = useState<AccountCategory[]>(
    () => getDefaultDecumulationOrder(),
  );
  const [withdrawalOrderTouched, setWithdrawalOrderTouched] = useState(false);
  const setWithdrawalOrder = useCallback((v: AccountCategory[]) => {
    setWithdrawalOrderRaw(v);
    setWithdrawalOrderTouched(true);
  }, []);
  const [withdrawalSplits, setWithdrawalSplitsRaw] = useState<
    Record<AccountCategory, number>
  >(() => ({ ...DEFAULT_WITHDRAWAL_SPLITS }));
  const [withdrawalSplitsTouched, setWithdrawalSplitsTouched] = useState(false);
  const setWithdrawalSplits = useCallback<
    Dispatch<SetStateAction<Record<AccountCategory, number>>>
  >((v) => {
    setWithdrawalSplitsRaw(v);
    setWithdrawalSplitsTouched(true);
  }, []);
  const [withdrawalTaxPref, setWithdrawalTaxPref] = useState<
    Partial<Record<AccountCategory, "traditional" | "roth">>
  >(() => defaultDecumulationConfig().withdrawalTaxPreference);

  // --- Overrides (persisted to DB, loaded on mount) ---
  const accumQuery = trpc.retirement.projectionOverrides.get.useQuery({
    overrideType: "accumulation",
  });
  const decumQuery = trpc.retirement.projectionOverrides.get.useQuery({
    overrideType: "decumulation",
  });
  // Track whether local state has been touched (add/delete) — once touched, local state wins over DB
  const [accumTouched, setAccumTouched] = useState(false);
  const [decumTouched, setDecumTouched] = useState(false);
  const [accumOverridesLocal, setAccumOverridesRaw] = useState<AccumOverride[]>(
    [],
  );
  const [decumOverridesLocal, setDecumOverridesRaw] = useState<DecumOverride[]>(
    [],
  );
  // Use DB data until local state is touched
  const accumOverrides = accumTouched
    ? accumOverridesLocal
    : accumQuery.data && accumQuery.data.length > 0
      ? (accumQuery.data as AccumOverride[])
      : accumOverridesLocal;
  const decumOverrides = decumTouched
    ? decumOverridesLocal
    : decumQuery.data && decumQuery.data.length > 0
      ? (decumQuery.data as DecumOverride[])
      : decumOverridesLocal;
  // The first edit starts from the saved rows the section shows, not the
  // empty local list. The refs flip at once, so two edits in one tick don't
  // both start from the DB.
  const accumTouchedRef = useRef(false);
  const decumTouchedRef = useRef(false);
  const setAccumOverrides: React.Dispatch<
    React.SetStateAction<AccumOverride[]>
  > = (updater) => {
    const wasTouched = accumTouchedRef.current;
    accumTouchedRef.current = true;
    const saved = (accumQuery.data as AccumOverride[] | undefined) ?? [];
    setAccumTouched(true);
    setAccumOverridesRaw((local) => {
      const prev = wasTouched ? local : saved;
      return typeof updater === "function" ? updater(prev) : updater;
    });
  };
  const setDecumOverrides: React.Dispatch<
    React.SetStateAction<DecumOverride[]>
  > = (updater) => {
    const wasTouched = decumTouchedRef.current;
    decumTouchedRef.current = true;
    const saved = (decumQuery.data as DecumOverride[] | undefined) ?? [];
    setDecumTouched(true);
    setDecumOverridesRaw((local) => {
      const prev = wasTouched ? local : saved;
      return typeof updater === "function" ? updater(prev) : updater;
    });
  };

  // --- Override form UI state ---
  const [showAccumForm, setShowAccumForm] = useState(false);
  const [accumForm, setAccumForm] = useState<AccumOverrideForm>({
    ...emptyAccumForm,
  });
  const [showDecumForm, setShowDecumForm] = useState(false);
  const [decumForm, setDecumForm] = useState<DecumOverrideForm>({
    ...emptyDecumForm,
  });

  // --- View state ---
  const [projectionMode, setProjectionMode] = useState<
    "deterministic" | "monteCarlo"
  >("monteCarlo");
  const [simulationTrials, setSimulationTrials] = useState(
    SIMULATION_DEFAULT_TRIALS,
  );
  // Shared with the strategy comparison.
  const [simulationPreset, setSimulationPreset] = useSimulationPreset();
  // Default Advanced (real per-account tax tracking): Simple's single-bucket
  // collapse misleads when read as an account breakdown. Simple stays
  // available for a cFIREsim-comparable view.
  const [simulationTaxMode, setSimulationTaxMode] = useState<
    "simple" | "advanced"
  >(DEFAULT_SIMULATION.taxMode);
  const [simulationAssetClassOverrides, setSimulationAssetClassOverrides] =
    useState<AssetClassOverride[]>([]);
  const [dollarMode, setDollarMode] = useState<DollarBasis>("real");
  const [balanceView, setBalanceView] = useState<"taxType" | "account">(
    "taxType",
  );
  const [contributionView, setContributionView] = useState<
    "account" | "taxType"
  >("account");
  const [chartView, setChartView] = useState<"balance" | "strategy" | "budget">(
    "balance",
  );
  const [projectionView, setProjectionView] = useState<
    | "baseline"
    | "coastFire"
    | "coastFireToday"
    | "coastFireCustom"
    | "rateSeeded"
  >("baseline");
  // Coast FIRE "Custom Age" picker; `null` until the user sets a value. The
  // derived layer displays currentAge while null (unknown here at init; it
  // arrives from engineQuery).
  const [coastFireCustomAge, setCoastFireCustomAge] = useState<number | null>(
    null,
  );
  // Raw, unclamped text the "Check age" input shows while typing. Clamping
  // per keystroke would mangle multi-digit entry, so it happens only on blur /
  // "Check this age" (commitCoastFireAgeDraft in index.tsx).
  const [coastFireCustomAgeDraft, setCoastFireCustomAgeDraft] = useState<
    string | null
  >(null);
  const [showAllYears, setShowAllYears] = useState(false);
  const [showBars, setShowBars] = useState(true);
  // Separate from `showBars` so the Yearly Income Stability chart can default
  // off for reactive strategies without hiding the Balance chart's baseline.
  // The one BASELINE pill reads/writes whichever applies to the active chart.
  const [showStabilityBars, setShowStabilityBars] = useState(true);
  // Balance chart's decumulation income overlay (withdrawal + SS, secondary
  // axis; see projection-chart.tsx). On by default: "what am I living on".
  const [showIncome, setShowIncome] = useState(true);
  const [fanBandRange, setFanBandRange] = useState<
    "off" | "p25-p75" | "p10-p90" | "p5-p95"
  >("p25-p75");
  const [diagMode] = usePersistedToggle(SK_DIAG_MODE, false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showAccumMethodology, setShowAccumMethodology] = useState(false);
  const [showDecumMethodology, setShowDecumMethodology] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showModels, setShowModels] = useState(true);
  const [showDecumConfig, setShowDecumConfig] = useState(false);
  const [showLifeOverrides, setShowLifeOverrides] = useState(false);
  const [personFilter, setPersonFilter] = useState<"all" | number>("all");
  const isPersonFiltered = personFilter !== "all";
  const [_graphTooltip, _setGraphTooltip] = useState<{
    x: number;
    y: number;
    content: React.ReactNode;
  } | null>(null);

  // --- Contribution/Budget override form state ---
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    year: "",
    // "profile" = switch Contribution Profile; "salaryProfile" = switch
    // Salary Profile. Independent axes, so the form picks one source per row.
    source: "salaryProfile" as "custom" | "profile" | "salaryProfile",
    profileId: "",
    salaryProfileId: "",
    value: "",
    notes: "",
  });
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetForm, setBudgetForm] = useState({
    year: "",
    source: "custom" as "custom" | "profile",
    profileId: "",
    profileColumn: "0",
    value: "",
    notes: "",
  });

  return {
    withdrawalRoutingMode,
    setWithdrawalRoutingMode,
    withdrawalRoutingModeTouched,
    withdrawalOrder,
    setWithdrawalOrder,
    withdrawalOrderTouched,
    withdrawalSplits,
    setWithdrawalSplits,
    withdrawalSplitsTouched,
    withdrawalTaxPref,
    setWithdrawalTaxPref,
    accumOverrides,
    accumOverridesTouched: accumTouched,
    decumOverridesTouched: decumTouched,
    setAccumOverrides,
    decumOverrides,
    setDecumOverrides,
    showAccumForm,
    setShowAccumForm,
    accumForm,
    setAccumForm,
    showDecumForm,
    setShowDecumForm,
    decumForm,
    setDecumForm,
    projectionMode,
    setProjectionMode,
    simulationTrials,
    setSimulationTrials,
    simulationPreset,
    setSimulationPreset,
    simulationTaxMode,
    setSimulationTaxMode,
    simulationAssetClassOverrides,
    setSimulationAssetClassOverrides,
    dollarMode,
    setDollarMode,
    balanceView,
    setBalanceView,
    contributionView,
    setContributionView,
    chartView,
    setChartView,
    projectionView,
    setProjectionView,
    coastFireCustomAge,
    setCoastFireCustomAge,
    coastFireCustomAgeDraft,
    setCoastFireCustomAgeDraft,
    showAllYears,
    setShowAllYears,
    showBars,
    setShowBars,
    showStabilityBars,
    setShowStabilityBars,
    showIncome,
    setShowIncome,
    fanBandRange,
    setFanBandRange,
    diagMode,
    showMethodology,
    setShowMethodology,
    showAccumMethodology,
    setShowAccumMethodology,
    showDecumMethodology,
    setShowDecumMethodology,
    showValidation,
    setShowValidation,
    showAssumptions,
    setShowAssumptions,
    showModels,
    setShowModels,
    showDecumConfig,
    setShowDecumConfig,
    showLifeOverrides,
    setShowLifeOverrides,
    personFilter,
    setPersonFilter,
    isPersonFiltered,
    _graphTooltip,
    _setGraphTooltip,
    showSalaryForm,
    setShowSalaryForm,
    salaryForm,
    setSalaryForm,
    showBudgetForm,
    setShowBudgetForm,
    budgetForm,
    setBudgetForm,
  };
}

export type ProjectionFormState = ReturnType<typeof useProjectionFormState>;
