/** Form and UI state for the projection card — withdrawal config, override forms, view toggles, and MC settings. Overrides are loaded from DB on mount. */
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AccountCategory } from "@/lib/calculators/types";
import { trpc } from "@/lib/trpc";
import { type AssetClassOverride } from "@/components/cards/mc-simulation-assumptions";
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
import { MC_DEFAULT_TRIALS } from "@/lib/constants";

export function useProjectionFormState() {
  // --- Withdrawal config ---
  // Each seeded from defaultDecumulationConfig() (account-types.ts) — the
  // SAME shared default the dashboard Retirement tile's cache-key-matching
  // "peek" queries reproduce, so the two can't independently drift the way
  // they had before this was consolidated.
  // `withdrawalRoutingModeTouched` gates whether this session's selection
  // is actually SENT as a decumulationDefaults override (use-projection-
  // queries.ts's baseSharedInput) — untouched, the query omits the field
  // entirely so the server resolves the household's persisted
  // `retirement_settings.withdrawal_routing_mode` instead
  // (buildDecumulationDefaults, server/routers/projection/_shared.ts).
  // This state's own initial value is `DEFAULT_WITHDRAWAL_ROUTING_MODE`
  // (NOT the fetched settings value) deliberately — it's never SENT until
  // touched anyway, so what it starts at doesn't affect the engine input;
  // `decumulation-config.tsx` derives its own display-only value (from the
  // real persisted setting) for what the toggle/sub-controls actually
  // show. `defaultDecumulationConfig()` (account-types.ts) deliberately
  // does NOT carry this field any more — see that function's docblock for
  // the bug this state used to cause (the dashboard tile's "peek" query
  // sending a hardcoded "bracket_filling" that silently overruled a
  // household's real "waterfall"/"percentage" setting).
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
  // Same touched-gating as `withdrawalRoutingMode` above — the order and
  // splits are only SENT as a decumulationDefaults override once the user
  // edits them this session; until then the query omits them and the server
  // resolves `retirement_settings.withdrawal_order` / `.withdrawal_splits`.
  // Initial values are the config defaults (NOT the fetched settings) since
  // they're never sent until touched; `decumulation-config.tsx` derives its
  // own display value from the real persisted setting.
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
  const setAccumOverrides: React.Dispatch<
    React.SetStateAction<AccumOverride[]>
  > = (updater) => {
    setAccumTouched(true);
    setAccumOverridesRaw(updater);
  };
  const setDecumOverrides: React.Dispatch<
    React.SetStateAction<DecumOverride[]>
  > = (updater) => {
    setDecumTouched(true);
    setDecumOverridesRaw(updater);
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
  const [mcTrials, setMcTrials] = useState(MC_DEFAULT_TRIALS);
  const [mcPreset, setMcPreset] = useState<
    "aggressive" | "default" | "conservative" | "custom"
  >("default");
  // Default to Advanced (real per-account tax tracking) rather than
  // Simple (cFIREsim-style single-bucket comparison) — most households
  // have real Traditional/Roth/HSA/brokerage splits they care about
  // seeing, and Simple mode's collapse turned out to actively mislead
  // when displayed as if it were a real account breakdown. Simple stays
  // available for anyone who specifically wants the cFIREsim-comparable
  // view.
  const [mcTaxMode, setMcTaxMode] = useState<"simple" | "advanced">("advanced");
  const [mcAssetClassOverrides, setMcAssetClassOverrides] = useState<
    AssetClassOverride[]
  >([]);
  const [dollarMode, setDollarMode] = useState<"nominal" | "real">("real");
  const [balanceView, setBalanceView] = useState<"taxType" | "account">(
    "taxType",
  );
  const [contribView, setContribView] = useState<"account" | "taxType">(
    "account",
  );
  const [chartView, setChartView] = useState<"balance" | "strategy" | "budget">(
    "balance",
  );
  const [scenarioView, setScenarioView] = useState<
    | "baseline"
    | "coastFire"
    | "coastFireToday"
    | "coastFireCustom"
    | "rateSeeded"
  >("baseline");
  // Coast FIRE "Custom Age" picker. `null` until the
  // household has typed/stepped a value OR `currentAge` becomes known
  // (derived layer defaults the DISPLAYED value to currentAge when this
  // is null — kept null here, not seeded to currentAge directly, since
  // this hook has no access to currentAge at initialization time; it
  // only arrives later from engineQuery's server response).
  const [coastFireCustomAge, setCoastFireCustomAge] = useState<number | null>(
    null,
  );
  // Raw text the "Check age" input displays WHILE typing — separate from
  // coastFireCustomAge (the committed, clamped number). Clamping on every
  // keystroke (the original implementation) corrupted multi-digit entry:
  // typing "42" with a min bound above 4 clamped the first "4" up to the
  // min immediately, forcing the DOM value to e.g. "38" mid-keystroke, so
  // the next digit landed in the wrong place and produced a mangled number
  // like "54" instead of "42". Clamping now happens only on blur / "Check
  // this age", via commitCoastFireAgeDraft
  // in index.tsx — this field just tracks whatever the user has typed so
  // far, unclamped.
  const [coastFireCustomAgeDraft, setCoastFireCustomAgeDraft] = useState<
    string | null
  >(null);
  const [showAllYears, setShowAllYears] = useState(false);
  const [showBars, setShowBars] = useState(true);
  // Separate from `showBars` (the Balance chart's own baseline toggle) so
  // the Yearly Income Stability chart can default this off for a
  // reactive strategy (Guyton-Klinger etc. -- flat/uneventful without
  // real volatility) without silently also hiding the Balance chart's
  // baseline, which is meaningful regardless of strategy. The shared
  // BASELINE pill in index.tsx's toolbar reads/writes whichever of the two
  // is relevant for the currently-active chart, so there's still only one
  // visible toggle -- not two overlapping ones. A separate "Show anyway"
  // link was confusing because the real BASELINE toggle appeared to do
  // nothing on this chart.
  const [showStabilityBars, setShowStabilityBars] = useState(true);
  // Balance chart's decumulation-year income overlay (total portfolio
  // withdrawal + Social Security, secondary axis) — see projection-chart.tsx.
  // Default on: this answers a real question ("what am I actually living
  // on, and how much of it is SS") every retiree-facing view of this chart
  // should surface, not an opt-in power-user feature.
  const [showIncome, setShowIncome] = useState(true);
  const [fanBandRange, setFanBandRange] = useState<
    "off" | "p25-p75" | "p10-p90" | "p5-p95"
  >("p25-p75");
  const [diagMode] = usePersistedToggle("diag_mode", false);
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
    mcTrials,
    setMcTrials,
    mcPreset,
    setMcPreset,
    mcTaxMode,
    setMcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    dollarMode,
    setDollarMode,
    balanceView,
    setBalanceView,
    contribView,
    setContribView,
    chartView,
    setChartView,
    scenarioView,
    setScenarioView,
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
