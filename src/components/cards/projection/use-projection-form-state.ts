/** Form and UI state for the projection card — withdrawal config, override forms, view toggles, and MC settings. Overrides are loaded from DB on mount. */
import { useState } from "react";
import type { AccountCategory } from "@/lib/calculators/types";
import { trpc } from "@/lib/trpc";
import { type AssetClassOverride } from "@/components/cards/mc-simulation-assumptions";
import { defaultDecumulationConfig } from "@/lib/config/account-types";
import type {
  AccumOverrideForm,
  DecumOverrideForm,
  AccumOverride,
  DecumOverride,
} from "./types";
import { emptyAccumForm, emptyDecumForm } from "./types";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";

export function useProjectionFormState() {
  // --- Withdrawal config ---
  // Each seeded from defaultDecumulationConfig() (account-types.ts) — the
  // SAME shared default the dashboard Retirement tile's cache-key-matching
  // "peek" queries reproduce, so the two can't independently drift the way
  // they had before this was consolidated.
  const [withdrawalRoutingMode, setWithdrawalRoutingMode] = useState<
    "bracket_filling" | "waterfall" | "percentage"
  >(() => defaultDecumulationConfig().withdrawalRoutingMode);
  const [withdrawalOrder, setWithdrawalOrder] = useState<AccountCategory[]>(
    () => defaultDecumulationConfig().withdrawalOrder,
  );
  const [withdrawalSplits, setWithdrawalSplits] = useState<
    Record<AccountCategory, number>
  >(() => defaultDecumulationConfig().withdrawalSplits);
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
  const [mcTrials, setMcTrials] = useState(1000);
  const [mcPreset, setMcPreset] = useState<
    "aggressive" | "default" | "conservative" | "custom"
  >("default");
  // Default to Advanced (real per-account tax tracking) rather than
  // Simple (cFIREsim-style single-bucket comparison) — most households
  // have real Traditional/Roth/HSA/brokerage splits they care about
  // seeing, and Simple mode's collapse turned out to actively mislead
  // when displayed as if it were a real account breakdown (live-user
  // finding, 2026-08-28). Simple stays available for anyone who
  // specifically wants the cFIREsim-comparable view.
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
    "baseline" | "coastFire" | "coastFireToday" | "rateSeeded"
  >("baseline");
  const [showAllYears, setShowAllYears] = useState(false);
  const [showBars, setShowBars] = useState(true);
  // Separate from `showBars` (the Balance chart's own baseline toggle) so
  // the Yearly Income Stability chart can default this off for a
  // reactive strategy (Guyton-Klinger etc. -- flat/uneventful without
  // real volatility) without silently also hiding the Balance chart's
  // baseline, which is meaningful regardless of strategy. The shared
  // BASELINE pill in index.tsx's toolbar reads/writes whichever of the two
  // is relevant for the currently-active chart, so there's still only one
  // visible toggle -- not two overlapping ones (user feedback, 2026-08-28:
  // a separate "Show anyway" link was confusing because the real BASELINE
  // toggle appeared to do nothing on this chart).
  const [showStabilityBars, setShowStabilityBars] = useState(true);
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
    withdrawalOrder,
    setWithdrawalOrder,
    withdrawalSplits,
    setWithdrawalSplits,
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
    showAllYears,
    setShowAllYears,
    showBars,
    setShowBars,
    showStabilityBars,
    setShowStabilityBars,
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
