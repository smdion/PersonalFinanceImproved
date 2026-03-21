import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { usePersistedToggle } from "@/lib/hooks/use-persisted-setting";
import type {
  AccountCategory,
  EngineYearProjection,
  EngineAccumulationYear,
  MonteCarloPercentileBand,
} from "@/lib/calculators/types";
import { type AssetClassOverride } from "@/components/cards/mc-simulation-assumptions";
import {
  type AccountCategory as AcctCat,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  buildCategoryRecord,
  categoriesWithTaxPreference,
  getAccountTypeConfig,
  getDefaultAccumulationOrder,
  getDefaultDecumulationOrder,
  taxTypeToSubKey,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import type {
  AccumOverrideForm,
  DecumOverrideForm,
  AccumOverride,
  DecumOverride,
} from "./types";
import { emptyAccumForm, emptyDecumForm } from "./types";
import {
  renderTooltip as _renderTooltip,
} from "./tooltip-renderer";
import {
  ALL_CATEGORIES,
  ROTH_CONVERSION_BRACKET_PRESETS,
  _singleBucketCategories,
  filterYearByParentCategory,
} from "./utils";

/** Contribution rate schedule entry derived from engine results, for relocation analysis. */
export type EngineContribRate = { year: number; rate: number };

/** Per-category account breakdown with display names (for balance tooltips). */
export type AcctBreakdown = {
  name: string;
  amount: number;
  taxType: string;
  ownerName?: string;
  ownerPersonId?: number;
  accountType?: string;
  parentCategory?: string;
};

export type UseProjectionStateProps = {
  people?: { id: number; name: string; birthYear: number }[];
  onContributionRates?: (rates: EngineContribRate[]) => void;
  withdrawalRate: number;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  parentCategoryFilter?: string;
  contributionProfileId?: number;
  snapshotId?: number;
};

export function useProjectionState({
  people,
  onContributionRates,
  withdrawalRate: withdrawalRateProp,
  accumulationBudgetProfileId,
  accumulationBudgetColumn,
  accumulationExpenseOverride,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
  parentCategoryFilter,
  contributionProfileId,
  snapshotId,
}: UseProjectionStateProps) {
  const salaryOverrides = useSalaryOverrides();

  const withdrawalRate = withdrawalRateProp;
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

  // --- Salary/Budget override form state ---
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    year: "",
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

  // --- Salary/Budget override mutations ---
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
  // --- Debounced query inputs ---
  // Form state updates instantly for responsive UI; queries only fire after 600ms of inactivity
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
    {
      placeholderData: (prev) => prev,
    },
  );

  /** Roth conversion bracket presets — DB-loaded when available, static fallback otherwise. */
  const rothBracketPresets = useMemo(() => {
    const data = engineQuery.data;
    const dbPresets =
      data && "rothConversionPresets" in data
        ? data.rothConversionPresets
        : undefined;
    if (dbPresets && dbPresets.length > 0) return dbPresets.map(String);
    return ROTH_CONVERSION_BRACKET_PRESETS;
  }, [engineQuery.data]);

  /** Resolved display name for the active person filter (empty string when 'all'). */
  const personFilterName =
    isPersonFiltered && engineQuery.data?.result && engineQuery.data.people
      ? (engineQuery.data.people.find(
          (p: { id: number; name: string }) => p.id === personFilter,
        )?.name ?? "")
      : "";

  // Background MC prefetch — runs after deterministic query succeeds with 1K trials / default preset
  // Provides MC bands on the deterministic bar chart before user switches to full MC
  // Waits for deterministic query to avoid competing for the single-threaded Node.js event loop
  const mcPrefetchQuery = trpc.projection.computeMonteCarloProjection.useQuery(
    {
      numTrials: 1000,
      preset: "default" as const,
      taxMode: mcTaxMode,
      ...debouncedInput,
    },
    {
      enabled: engineQuery.isSuccess && !engineQuery.isFetching,
      staleTime: 5 * 60 * 1000,
      placeholderData: (prev) => prev,
    },
  );

  // Full MC query — only fetches when MC mode is active (user-selected preset/trials)
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
  }, [mcQuery.data?.savedOverrides, mcPrefetchQuery.data?.savedOverrides]);

  // True when MC is active but data is not yet available (initial load or preset switch)
  const mcLoading =
    projectionMode === "monteCarlo" &&
    (mcQuery.isLoading || mcQuery.isFetching);

  // MC percentile bands by year — tiered: full MC query > prefetch > null
  // In MC mode during refetch (preset switch), return null to avoid showing stale data
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

  // Whether the current MC bands are from the prefetch (1K default) vs full MC query
  const mcIsPrefetch =
    projectionMode !== "monteCarlo" || !mcQuery.data?.result?.percentileBands;

  // True when any MC data (full or prefetch) is still loading and no bands are available yet
  const mcChartPending =
    mcLoading || (!mcBandsByYear && mcPrefetchQuery.isFetching);

  // MC deterministic projection by year — same tiered logic + parentCategoryFilter
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

  // --- Override form submission ---
  const handleAddAccumOverride = useCallback(() => {
    const year = parseInt(accumForm.year);
    if (isNaN(year)) return;

    const o: AccumOverride = { year };
    if (accumForm.personName) o.personName = accumForm.personName;
    if (accumForm.reset) {
      o.reset = true;
    } else {
      if (accumForm.contributionRate !== "")
        o.contributionRate = parseFloat(accumForm.contributionRate) / 100;
      if (accumForm.routingMode !== "")
        o.routingMode = accumForm.routingMode as "waterfall" | "percentage";
      // Only include accountOrder if changed from default
      const defaultOrder = getDefaultAccumulationOrder();
      if (
        JSON.stringify(accumForm.accountOrder) !== JSON.stringify(defaultOrder)
      )
        o.accountOrder = accumForm.accountOrder;
      // Account splits
      const splits: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasSplits = false;
      for (const cat of ALL_CATEGORIES) {
        if (accumForm.accountSplits[cat] !== "") {
          splits[cat] = parseFloat(accumForm.accountSplits[cat]) / 100;
          hasSplits = true;
        }
      }
      if (hasSplits) o.accountSplits = splits;
      // Tax splits — keyed by limit group (e.g. '401k', 'ira')
      const ts: Record<string, number> = {};
      for (const [groupKey, val] of Object.entries(accumForm.taxSplits)) {
        if (val !== "") ts[groupKey] = parseFloat(val) / 100;
      }
      if (Object.keys(ts).length > 0) o.taxSplits = ts;
      // Account caps
      const caps: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasCaps = false;
      for (const cat of ALL_CATEGORIES) {
        if (accumForm.accountCaps[cat] !== "") {
          caps[cat] = parseFloat(accumForm.accountCaps[cat]);
          hasCaps = true;
        }
      }
      if (hasCaps) o.accountCaps = caps;
      // Tax type caps
      const ttc: Partial<Record<"traditional" | "roth", number>> = {};
      if (accumForm.taxTypeCaps.traditional !== "")
        ttc.traditional = parseFloat(accumForm.taxTypeCaps.traditional);
      if (accumForm.taxTypeCaps.roth !== "")
        ttc.roth = parseFloat(accumForm.taxTypeCaps.roth);
      if (Object.keys(ttc).length > 0) o.taxTypeCaps = ttc;
    }
    if (accumForm.notes) o.notes = accumForm.notes;

    setAccumOverrides((prev) => {
      const filtered = prev.filter((x) => x.year !== year);
      return [...filtered, o].sort((a, b) => a.year - b.year);
    });
    setAccumForm({
      ...emptyAccumForm,
      year: String(year + 1),
      personName: isPersonFiltered ? personFilterName : "",
    });
    setShowAccumForm(false);
  }, [accumForm, isPersonFiltered, personFilterName]);

  const handleAddDecumOverride = useCallback(() => {
    const year = parseInt(decumForm.year);
    if (isNaN(year)) return;

    const o: DecumOverride = { year };
    if (decumForm.personName) o.personName = decumForm.personName;
    if (decumForm.reset) {
      o.reset = true;
    } else {
      if (decumForm.withdrawalRate !== "")
        o.withdrawalRate = parseFloat(decumForm.withdrawalRate) / 100;
      if (decumForm.withdrawalRoutingMode !== "")
        o.withdrawalRoutingMode = decumForm.withdrawalRoutingMode;
      const defaultOrder = getDefaultDecumulationOrder();
      if (
        JSON.stringify(decumForm.withdrawalOrder) !==
        JSON.stringify(defaultOrder)
      )
        o.withdrawalOrder = decumForm.withdrawalOrder;
      // Withdrawal splits
      const wsplits: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasWSplits = false;
      for (const cat of ALL_CATEGORIES) {
        if (decumForm.withdrawalSplits[cat] !== "") {
          wsplits[cat] = parseFloat(decumForm.withdrawalSplits[cat]) / 100;
          hasWSplits = true;
        }
      }
      if (hasWSplits) o.withdrawalSplits = wsplits;
      // Tax preferences
      const prefs: Record<string, "traditional" | "roth"> = {};
      for (const cat of ALL_CATEGORIES) {
        if (decumForm.withdrawalTaxPreference[cat] !== "") {
          prefs[cat] = decumForm.withdrawalTaxPreference[cat] as
            | "traditional"
            | "roth";
        }
      }
      if (Object.keys(prefs).length > 0) o.withdrawalTaxPreference = prefs;
      // Withdrawal caps
      const caps: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasWCaps = false;
      for (const cat of ALL_CATEGORIES) {
        if (decumForm.withdrawalAccountCaps[cat] !== "") {
          caps[cat] = parseFloat(decumForm.withdrawalAccountCaps[cat]);
          hasWCaps = true;
        }
      }
      if (hasWCaps) o.withdrawalAccountCaps = caps;
      // Tax type caps
      const ttc: Partial<Record<"traditional" | "roth", number>> = {};
      if (decumForm.withdrawalTaxTypeCaps.traditional !== "")
        ttc.traditional = parseFloat(
          decumForm.withdrawalTaxTypeCaps.traditional,
        );
      if (decumForm.withdrawalTaxTypeCaps.roth !== "")
        ttc.roth = parseFloat(decumForm.withdrawalTaxTypeCaps.roth);
      if (Object.keys(ttc).length > 0) o.withdrawalTaxTypeCaps = ttc;
      // Roth conversion target
      if (decumForm.rothConversionTarget !== "") {
        o.rothConversionTarget = parseFloat(decumForm.rothConversionTarget);
      }
    }
    if (decumForm.notes) o.notes = decumForm.notes;

    setDecumOverrides((prev) => {
      const filtered = prev.filter((x) => x.year !== year);
      return [...filtered, o].sort((a, b) => a.year - b.year);
    });
    setDecumForm({
      ...emptyDecumForm,
      year: String(year + 1),
      personName: isPersonFiltered ? personFilterName : "",
    });
    setShowDecumForm(false);
  }, [decumForm, isPersonFiltered, personFilterName]);

  // --- Derived data ---
  // The tRPC endpoint returns { result: null } | { result: ..., baseLimits: ..., ... }
  // Narrow to the success branch before accessing fields.
  const engineData = engineQuery.data;
  // Pre-filter by parentCategory when set — recomputes all aggregate fields from filtered IABs.
  // This ensures ALL tooltips, charts, and math on this page only see the filtered accounts.
  const rawResult = engineData?.result ?? null;
  const result = useMemo(() => {
    if (!rawResult || !parentCategoryFilter) return rawResult;
    return {
      ...rawResult,
      projectionByYear: rawResult.projectionByYear.map((yr) =>
        filterYearByParentCategory(yr, parentCategoryFilter),
      ),
    };
  }, [rawResult, parentCategoryFilter]);
  const combinedSalary =
    engineData && engineData.result ? engineData.combinedSalary : 0;
  const enginePeople =
    engineData && engineData.result ? engineData.people : undefined;
  const realDefaults =
    engineData && engineData.result ? engineData.realDefaults : undefined;
  const dbSalaryOverridesAll =
    engineData && engineData.result ? engineData.dbSalaryOverrides : undefined;
  const dbBudgetOverrides =
    engineData && engineData.result ? engineData.dbBudgetOverrides : undefined;
  const primaryPersonId =
    engineData && engineData.result ? engineData.primaryPersonId : undefined;
  const salaryByPerson: Record<number, number> | undefined =
    engineData && engineData.result && "salaryByPerson" in engineData
      ? (engineData.salaryByPerson as Record<number, number>)
      : undefined;

  // Filter salary overrides by person filter
  const dbSalaryOverrides = useMemo(() => {
    if (!dbSalaryOverridesAll) return undefined;
    if (!isPersonFiltered || !enginePeople) return dbSalaryOverridesAll;
    const person = enginePeople.find((p) => p.id === personFilter);
    if (!person) return dbSalaryOverridesAll;
    return dbSalaryOverridesAll.filter((o) => o.personId === person.id);
  }, [dbSalaryOverridesAll, isPersonFiltered, personFilter, enginePeople]);

  // Resolve the target personId for creating salary overrides
  const salaryOverridePersonId = useMemo(() => {
    if (!isPersonFiltered || !enginePeople) return primaryPersonId;
    const person = enginePeople.find((p) => p.id === personFilter);
    return person?.id ?? primaryPersonId;
  }, [isPersonFiltered, personFilter, enginePeople, primaryPersonId]);
  const engineSettings =
    engineData && engineData.result ? engineData.settings : undefined;
  const annualExpenses =
    engineData && engineData.result ? engineData.annualExpenses : 0;
  const budgetProfileSummaries =
    engineData && engineData.result
      ? engineData.budgetProfileSummaries
      : undefined;
  const contribSpecs = useMemo(() => {
    const raw =
      engineData && engineData.result && "contributionSpecs" in engineData
        ? (engineData.contributionSpecs as {
            category: string;
            name: string;
            method: string;
            value: number;
            baseAnnual: number;
            taxTreatment: string;
            ownerName: string | null;
            personId?: number;
            matchAnnual?: number;
            parentCategory?: string;
            accountDisplayName?: string;
          }[])
        : undefined;
    if (!raw || !parentCategoryFilter) return raw;
    return raw.filter((s) => s.parentCategory === parentCategoryFilter);
  }, [engineData, parentCategoryFilter]);

  // Per-person balance from real engine individual account data.
  // Returns summed balance/contribution/growth for the selected person from
  // individualAccountBalances (DB-sourced ownerName), or null for 'all'.

  /** Sum individual account balances for a given person in a given year. */
  const getPersonYearTotals = useCallback(
    (yr: EngineYearProjection) => {
      if (!isPersonFiltered) return null;
      const iabs = yr.individualAccountBalances ?? [];
      const mine = iabs.filter((ia) => ia.ownerPersonId === personFilter);
      const balance = mine.reduce((s, ia) => s + ia.balance, 0);
      const contribution = mine.reduce(
        (s, ia) => s + ia.contribution + ia.employerMatch,
        0,
      );
      const growth = mine.reduce((s, ia) => s + ia.growth, 0);
      // By tax type — config-driven bucket assignment
      const byTaxType = { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0 };
      for (const ia of mine) {
        if (ia.taxType === "taxFree") {
          byTaxType.taxFree += ia.balance;
        } else {
          const cfg =
            ia.category in ACCOUNT_TYPE_CONFIG
              ? ACCOUNT_TYPE_CONFIG[ia.category as AcctCat]
              : null;
          const bucket = cfg ? cfg.taxBucketKey : "preTax";
          if (bucket in byTaxType) {
            byTaxType[bucket as keyof typeof byTaxType] += ia.balance;
          } else {
            byTaxType.preTax += ia.balance;
          }
        }
      }
      // By account bucket (for chart segments) — config-driven
      const byAccount: Record<string, number> = Object.fromEntries(
        getAccountSegments().map((seg) => [seg.key, 0]),
      );
      for (const ia of mine) {
        const cat = ia.category as AcctCat;
        const cfg =
          cat in ACCOUNT_TYPE_CONFIG ? ACCOUNT_TYPE_CONFIG[cat] : null;
        if (cfg && cfg.supportsRothSplit) {
          const subKey = taxTypeToSubKey(ia.taxType);
          const key = `${cat}_${subKey}`;
          byAccount[key] = (byAccount[key] ?? 0) + ia.balance;
        } else {
          byAccount[cat] = (byAccount[cat] ?? 0) + ia.balance;
        }
      }
      // By category (for contribution columns)
      const byCategoryContrib: Record<
        string,
        { employee: number; match: number }
      > = {};
      for (const ia of mine) {
        const cat = ia.category;
        if (!byCategoryContrib[cat])
          byCategoryContrib[cat] = { employee: 0, match: 0 };
        byCategoryContrib[cat].employee += ia.contribution;
        byCategoryContrib[cat].match += ia.employerMatch;
      }
      return {
        balance,
        contribution,
        growth,
        byTaxType,
        byAccount,
        byCategoryContrib,
      };
    },
    [isPersonFiltered, personFilter],
  );

  // Per-person depletion age: when filtered person's balance hits zero
  const personDepletionInfo = useMemo(() => {
    if (!isPersonFiltered || !result) return null;
    for (const yr of result.projectionByYear) {
      if (yr.phase !== "decumulation") continue;
      const iabs = yr.individualAccountBalances ?? [];
      const mine = iabs.filter((ia) => ia.ownerPersonId === personFilter);
      const balance = mine.reduce((s, ia) => s + ia.balance, 0);
      if (balance <= 0) return { year: yr.year, age: yr.age };
    }
    return null; // never depletes within projection
  }, [isPersonFiltered, personFilter, result]);

  // Per-category account breakdown with display names (for balance tooltips)
  const accountBreakdown: Record<string, AcctBreakdown[]> =
    engineData &&
    engineData.result &&
    "accountBreakdownByCategory" in engineData
      ? (engineData.accountBreakdownByCategory as Record<
          string,
          AcctBreakdown[]
        >)
      : {};

  // Person-filtered + parentCategory-filtered account breakdown for headers/tooltips
  const filteredBreakdown = useMemo(() => {
    let base = accountBreakdown;
    // Filter by parentCategory first
    if (parentCategoryFilter) {
      const out: Record<string, AcctBreakdown[]> = {};
      for (const [cat, accts] of Object.entries(base)) {
        const f = accts.filter(
          (a) => a.parentCategory === parentCategoryFilter,
        );
        if (f.length > 0) out[cat] = f;
      }
      base = out;
    }
    if (!isPersonFiltered) return base;
    const out: Record<string, AcctBreakdown[]> = {};
    for (const [cat, accts] of Object.entries(base)) {
      const filtered = accts.filter((a) => a.ownerPersonId === personFilter);
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [accountBreakdown, isPersonFiltered, personFilter, parentCategoryFilter]);

  // Determine which contribution categories and balance-account columns have any non-zero data
  // so we can hide entirely-zero columns (e.g. 403b when nobody has one).
  const visibleColumns = useMemo(() => {
    const contribCats = new Set<string>();
    const contribTaxTypes = new Set<string>();
    const balanceAccts = new Set<string>();
    const balanceTaxTypes = new Set<string>();
    if (result) {
      for (const yr of result.projectionByYear) {
        // Contribution categories — check both accumulation contributions and decumulation withdrawals
        if (
          "slots" in yr &&
          Array.isArray((yr as unknown as Record<string, unknown>).slots)
        ) {
          for (const slot of (yr as unknown as Record<string, unknown>)
            .slots as Record<string, unknown>[]) {
            const hasContrib =
              (slot.employeeContrib ?? 0) !== 0 ||
              (slot.employerMatch ?? 0) !== 0;
            const hasWithdrawal = (slot.withdrawal ?? 0) !== 0;
            if (hasContrib || hasWithdrawal) {
              contribCats.add(slot.category as string);
            }
            // Contribution tax types
            if (
              (slot.traditionalContrib ?? 0) !== 0 ||
              (slot.traditionalWithdrawal ?? 0) !== 0
            )
              contribTaxTypes.add("preTax");
            if (
              (slot.rothContrib ?? 0) !== 0 ||
              (slot.rothWithdrawal ?? 0) !== 0
            )
              contribTaxTypes.add("taxFree");
            // For single-bucket categories, add their tax bucket key
            if (
              (hasContrib || hasWithdrawal) &&
              _singleBucketCategories.has(slot.category as string)
            ) {
              const slotCfg = ACCOUNT_TYPE_CONFIG[slot.category as AcctCat];
              contribTaxTypes.add(slotCfg.taxBucketKey);
            }
          }
        }
        // Balance by account
        if (yr.balanceByAccount) {
          for (const seg of getAccountSegments()) {
            if (getSegmentBalance(yr.balanceByAccount, seg) !== 0)
              balanceAccts.add(seg.key);
          }
        }
        // Balance by tax type
        if (yr.balanceByTaxType) {
          const bt = yr.balanceByTaxType;
          if (bt.preTax !== 0) balanceTaxTypes.add("preTax");
          if (bt.taxFree !== 0) balanceTaxTypes.add("taxFree");
          if (bt.hsa !== 0) balanceTaxTypes.add("hsa");
          if (bt.afterTax !== 0) balanceTaxTypes.add("afterTax");
        }
      }
    }
    return { contribCats, contribTaxTypes, balanceAccts, balanceTaxTypes };
  }, [result]);

  // Generic column labels — specific account names are in tooltips (balanceHeaderTooltip)
  const columnLabel: Record<string, string> = Object.fromEntries(
    getAccountSegments().map((seg) => [seg.key, seg.label]),
  );

  // Build dynamic contribution-column header tooltips from actual account names
  const contribHeaderTooltip = useMemo(() => {
    const tips: Record<string, string> = {};
    for (const cat of getAllCategories()) {
      const accts = filteredBreakdown[cat];
      if (accts && accts.length > 0) {
        const names = accts.map((a) => a.name).join(",");
        tips[cat] = `${names}. Hover values for breakdown.`;
      } else {
        const cfg = getAccountTypeConfig(cat);
        tips[cat] =
          `${cfg.displayLabel} contributions. Hover values for breakdown.`;
      }
    }
    return tips;
  }, [filteredBreakdown]);

  // Build dynamic balance-column header tooltips from actual account names
  const balanceHeaderTooltip = useMemo(() => {
    const byCol: Record<string, string[]> = {};
    const byTaxType: Record<string, string[]> = {
      preTax: [],
      taxFree: [],
      hsa: [],
      afterTax: [],
    };
    for (const [cat, accts] of Object.entries(filteredBreakdown)) {
      const cfg =
        cat in ACCOUNT_TYPE_CONFIG ? ACCOUNT_TYPE_CONFIG[cat as AcctCat] : null;
      for (const a of accts) {
        let colKey: string;
        if (cfg && cfg.supportsRothSplit) {
          colKey = `${cat}_${taxTypeToSubKey(a.taxType)}`;
        } else {
          colKey = cat;
        }
        if (!byCol[colKey]) byCol[colKey] = [];
        byCol[colKey]!.push(a.name);
        const taxBucket = cfg ? cfg.taxBucketKey : "afterTax";
        if (a.taxType === "taxFree") {
          byTaxType["taxFree"]!.push(a.name);
        } else if (taxBucket in byTaxType) {
          byTaxType[taxBucket]!.push(a.name);
        } else {
          byTaxType["preTax"]!.push(a.name);
        }
      }
    }
    const account: Record<string, string> = {};
    for (const [colKey, names] of Object.entries(byCol)) {
      account[colKey] = names.join(",");
    }
    const taxType: Record<string, string> = {};
    for (const [tt, names] of Object.entries(byTaxType)) {
      taxType[tt] = names.length > 0 ? names.join(",") : tt;
    }
    return { account, taxType };
  }, [filteredBreakdown]);

  // Deflate nominal dollars to today's purchasing power
  const inflationRate = engineSettings?.annualInflation
    ? Number(engineSettings.annualInflation)
    : 0.03;
  const baseYear = new Date().getFullYear();
  const deflate = (value: number, year: number) => {
    if (dollarMode === "nominal") return value;
    const years = year - baseYear;
    if (years <= 0) return value;
    return value / Math.pow(1 + inflationRate, years);
  };

  // Tooltip renderer
  const renderTooltip = _renderTooltip;

  // Derive contribution rate schedule from engine results and push to parent
  useEffect(() => {
    if (!onContributionRates || !result) {
      onContributionRates?.([]);
      return;
    }
    const rates: EngineContribRate[] = [];
    let prevRate: number | null = null;
    for (const yr of result.projectionByYear) {
      if (yr.phase !== "accumulation") break;
      const r = (yr as EngineAccumulationYear).config.contributionRate;
      if (r !== prevRate) {
        rates.push({ year: yr.year, rate: r });
        prevRate = r;
      }
    }
    onContributionRates(rates);
  }, [result, onContributionRates]);

  // Average birth year for age display
  const avgBirthYear = useMemo(() => {
    const pp = people ?? enginePeople;
    if (!pp || pp.length === 0) return null;
    return pp.reduce((s, p) => s + p.birthYear, 0) / pp.length;
  }, [people, enginePeople]);
  const displayAge = (year: number) =>
    avgBirthYear !== null ? Math.round(year - avgBirthYear) : null;

  // --- Milestone filtering ---
  const getFilteredYears = useCallback(
    (years: EngineYearProjection[]) => {
      if (showAllYears) return years;
      if (years.length === 0) return [];
      const milestones = new Set<number>();
      milestones.add(years[0]!.year);
      milestones.add(years[years.length - 1]!.year);
      // Every 5 years
      for (const yr of years) {
        if (yr.age % 5 === 0) milestones.add(yr.year);
      }
      // Phase transition
      for (let i = 1; i < years.length; i++) {
        if (years[i]!.phase !== years[i - 1]!.phase)
          milestones.add(years[i]!.year);
      }
      // Override years
      for (const o of accumOverrides) milestones.add(o.year);
      for (const o of decumOverrides) milestones.add(o.year);
      // Overflow year
      if (result?.firstOverflowYear) milestones.add(result.firstOverflowYear);
      // Depletion year
      if (result?.portfolioDepletionYear)
        milestones.add(result.portfolioDepletionYear);
      return years.filter((yr) => milestones.has(yr.year));
    },
    [showAllYears, accumOverrides, decumOverrides, result],
  );

  // =========================================================================
  // FLAT RETURN — every variable the component previously accessed directly
  // =========================================================================
  return {
    // State + setters
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

    // Mutations
    createSalaryOverride,
    deleteSalaryOverride,
    createBudgetOverride,
    deleteBudgetOverride,
    updateGlidePath,
    updateInflationRisk,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,

    // Queries
    engineQuery,
    mcPrefetchQuery,
    mcQuery,

    // Derived / memos
    withdrawalRate,
    sharedInput,
    debouncedInput,
    rothBracketPresets,
    personFilterName,
    mcLoading,
    mcBandsByYear,
    mcIsPrefetch,
    mcChartPending,
    mcDetByYear,
    handleAddAccumOverride,
    handleAddDecumOverride,
    engineData,
    rawResult,
    result,
    combinedSalary,
    enginePeople,
    realDefaults,
    dbSalaryOverrides,
    dbBudgetOverrides,
    primaryPersonId,
    salaryByPerson,
    salaryOverridePersonId,
    engineSettings,
    annualExpenses,
    budgetProfileSummaries,
    contribSpecs,
    getPersonYearTotals,
    personDepletionInfo,
    accountBreakdown,
    filteredBreakdown,
    visibleColumns,
    columnLabel,
    contribHeaderTooltip,
    balanceHeaderTooltip,
    inflationRate,
    baseYear,
    deflate,
    renderTooltip,
    avgBirthYear,
    displayAge,
    getFilteredYears,
  };
}
