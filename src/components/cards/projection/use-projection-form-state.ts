/** Pure local form and UI state for the projection card — withdrawal config, override forms, view toggles, and MC settings with no external dependencies. */
import { useState } from "react";
import type { AccountCategory } from "@/lib/calculators/types";
import { type AssetClassOverride } from "@/components/cards/mc-simulation-assumptions";
import {
  getAllCategories,
  categoriesWithTaxPreference,
  getDefaultDecumulationOrder,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import type { AccumOverrideForm, DecumOverrideForm, AccumOverride, DecumOverride } from "./types";
import { emptyAccumForm, emptyDecumForm } from "./types";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";

export function useProjectionFormState() {
  // --- Withdrawal config ---
  const [withdrawalRoutingMode, setWithdrawalRoutingMode] = useState<
    "bracket_filling" | "waterfall" | "percentage"
  >("bracket_filling");
  const [withdrawalOrder, setWithdrawalOrder] = useState<AccountCategory[]>(
    getDefaultDecumulationOrder,
  );
  const [withdrawalSplits, setWithdrawalSplits] = useState<
    Record<AccountCategory, number>
  >(
    () =>
      Object.fromEntries(
        getAllCategories().map((cat) => [
          cat,
          ACCOUNT_TYPE_CONFIG[cat].defaultWithdrawalSplit,
        ]),
      ) as Record<AccountCategory, number>,
  );
  const [withdrawalTaxPref, setWithdrawalTaxPref] = useState<
    Partial<Record<AccountCategory, "traditional" | "roth">>
  >(() =>
    Object.fromEntries(
      categoriesWithTaxPreference().map((cat) => [cat, "traditional" as const]),
    ),
  );

  // --- Overrides ---
  const [accumOverrides, setAccumOverrides] = useState<AccumOverride[]>([]);
  const [decumOverrides, setDecumOverrides] = useState<DecumOverride[]>([]);

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
  >("deterministic");
  const [mcTrials, setMcTrials] = useState(1000);
  const [mcPreset, setMcPreset] = useState<
    "aggressive" | "default" | "conservative" | "custom"
  >("default");
  const [mcTaxMode, setMcTaxMode] = useState<"simple" | "advanced">("simple");
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
  const [showAllYears, setShowAllYears] = useState(false);
  const [fanBandRange, setFanBandRange] = useState<
    "p25-p75" | "p10-p90" | "p5-p95"
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
    source: "profile" as "custom" | "profile",
    profileId: "",
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
    showAllYears,
    setShowAllYears,
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
