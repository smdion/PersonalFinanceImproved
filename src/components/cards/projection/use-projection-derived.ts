/** Memoized derived data from engine query results — person filtering, visible column detection, deflation, contribution rate schedules, tooltip rendering, and milestone-based year filtering. */
import { useMemo, useCallback, useEffect, useRef } from "react";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
} from "@/lib/calculators/types";
import {
  type AccountCategory,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  getAccountTypeConfig,
  taxTypeToSubKey,
  ACCOUNT_TYPE_CONFIG,
  isRetirementParent,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { emptyTaxBucketMap } from "@/lib/config/display-labels";
import { DEFAULT_INFLATION_RATE } from "@/lib/constants";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { ProjectionQueries } from "./use-projection-queries";
import type {
  UseProjectionStateProps,
  EngineContribRate,
  AccountBreakdown,
} from "./use-projection-state";
import { renderTooltip as _renderTooltip } from "./tooltip-renderer";
import {
  ROTH_CONVERSION_BRACKET_PRESETS,
  _singleBucketCategories,
  filterYearByParentCategory,
} from "./utils";
import {
  useFICache,
  deriveFI,
  isLivePlanInput,
} from "@/lib/hooks/use-fi-cache";
import { useScenario } from "@/lib/context/scenario-context";

export function useProjectionDerived(
  form: ProjectionFormState,
  queries: ProjectionQueries,
  props: UseProjectionStateProps,
) {
  const {
    accumOverrides,
    decumOverrides,
    dollarMode,
    showAllYears,
    personFilter,
    isPersonFiltered,
    scenarioView,
  } = form;

  const {
    engineQuery,
    contribProfilesQuery,
    salaryProfilesQuery,
    coastFireMcResult,
  } = queries;

  const {
    parentCategoryFilter,
    people,
    onContributionRates,
    contributionProfileId,
    salaryProfileId,
    snapshotId,
  } = props;
  const { isInScenario } = useScenario();

  // --- Engine data narrowing ---
  // In Coast FIRE scenario, swap the deterministic projection source from
  // the baseline engineQuery to the Coast FIRE MC run's internal
  // deterministicProjection. This swap is synchronous (React Query cache
  // read) and happens ATOMICALLY with the MC band swap, eliminating the
  // visual lag that occurred when engineQuery was refetching with
  // coastFireOverrideAge while MC bands updated instantly.
  const engineData = engineQuery.data;
  const rawResult = useMemo(() => {
    // Gate on engineData.result first, not just the coastFire branch: both
    // computeProjection and computeCoastFireMC guard on the same
    // payload-availability check server-side, so a coastFireMcResult can
    // only be legitimately non-null when engineData.result is too. Without
    // this guard, a stale/cached coastFireMcResult (longer staleTime,
    // placeholderData retention) could keep rendering a projection after
    // the underlying engine result has gone null (e.g. primary person
    // deleted) — this also keeps `result` truthy always implying
    // `engineSettings` defined below, removing the need for `!` assertions
    // at every consumer.
    if (!engineData?.result) return null;
    if (
      scenarioView === "coastFire" &&
      coastFireMcResult?.deterministicProjection
    ) {
      return coastFireMcResult.deterministicProjection;
    }
    return engineData.result;
  }, [
    scenarioView,
    coastFireMcResult?.deterministicProjection,
    engineData?.result,
  ]);
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

  // Internal-only — safe to read with `?.` here since every use below is a
  // fallback-guarded read, not an assumption the value exists. The
  // externally-exposed `engineSettings` (in the return statement) is paired
  // with `result` via a discriminated union instead.
  const engineSettings =
    engineData && engineData.result ? engineData.settings : undefined;
  const annualExpenses =
    engineData && engineData.result ? engineData.annualExpenses : 0;

  const [, writeFICache] = useFICache();
  const lastProjCacheKey = useRef<string | null>(null);
  useEffect(() => {
    if (!engineData?.result || engineQuery.isLoading || engineQuery.isFetching)
      return;
    // Only the live, no-override retirement plan may populate the
    // dashboard-wide FI cache — a scenario, historical snapshot, per-category,
    // or per-person filtered view is a DIFFERENT projection than what the
    // rest of the dashboard shows (H12). Note: dragging the
    // withdrawal-rate/order/split controls away from their stored defaults
    // isn't caught here yet — deferred, see review-findings.md H12.
    // contributionProfileId/salaryProfileId aren't checked — they're always
    // the resolved active profile absent a Plan pin, which isInScenario
    // already excludes (see isLivePlanInput's docstring, M27).
    if (
      !isLivePlanInput({
        isInScenario,
        snapshotId,
        accumulationOverrides: accumOverrides,
        decumulationOverrides: decumOverrides,
        parentCategoryFilter,
        isPersonFiltered,
      })
    )
      return;
    const withdrawalRate = Number(engineSettings?.withdrawalRate ?? 0.04);
    const expenses = annualExpenses as number;
    if (withdrawalRate <= 0 || expenses <= 0) return;
    const derived = deriveFI(
      engineData.result.projectionByYear,
      expenses,
      withdrawalRate,
    );
    if (lastProjCacheKey.current === derived.inputKey) return;
    lastProjCacheKey.current = derived.inputKey;
    writeFICache({
      fiYear: derived.fiYear,
      fiAge: derived.fiAge,
      inputKey: derived.inputKey,
      computedAt: new Date().toISOString(),
    });
  }, [
    engineData,
    engineQuery.isLoading,
    engineQuery.isFetching,
    engineSettings,
    annualExpenses,
    writeFICache,
    isInScenario,
    snapshotId,
    accumOverrides,
    decumOverrides,
    contributionProfileId,
    salaryProfileId,
    parentCategoryFilter,
    isPersonFiltered,
  ]);

  const decumulationExpenses =
    engineData && engineData.result
      ? ((engineData.decumulationExpenses as number | undefined) ?? null)
      : null;
  const budgetProfileSummaries =
    engineData && engineData.result
      ? engineData.budgetProfileSummaries
      : undefined;
  const contribProfileSummaries = contribProfilesQuery.data;
  const salaryProfileSummaries = salaryProfilesQuery.data;

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

  /** Resolved display name for the active person filter. */
  const personFilterName =
    isPersonFiltered && engineQuery.data?.result && engineQuery.data.people
      ? (engineQuery.data.people.find(
          (p: { id: number; name: string }) => p.id === personFilter,
        )?.name ?? "")
      : "";

  // --- Per-person helpers ---
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
      const byTaxType = emptyTaxBucketMap();
      for (const ia of mine) {
        if (isTaxFreeBucket(ia.taxType)) {
          byTaxType.taxFree += ia.balance;
        } else {
          const cfg =
            ia.category in ACCOUNT_TYPE_CONFIG
              ? ACCOUNT_TYPE_CONFIG[ia.category as AccountCategory]
              : null;
          const bucket = cfg ? cfg.taxBucketKey : "preTax";
          if (bucket in byTaxType) {
            byTaxType[bucket as keyof typeof byTaxType] += ia.balance;
          } else {
            byTaxType.preTax += ia.balance;
          }
        }
      }
      const byAccount: Record<string, number> = Object.fromEntries(
        getAccountSegments().map((seg) => [seg.key, 0]),
      );
      for (const ia of mine) {
        const cat = ia.category as AccountCategory;
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

  const personDepletionInfo = (() => {
    if (!isPersonFiltered || !result) return null;
    for (const yr of result.projectionByYear) {
      if (yr.phase !== "decumulation") continue;
      const iabs = yr.individualAccountBalances ?? [];
      const mine = iabs.filter((ia) => ia.ownerPersonId === personFilter);
      const balance = mine.reduce((s, ia) => s + ia.balance, 0);
      if (balance <= 0) return { year: yr.year, age: yr.age };
    }
    return null;
  })();

  // --- Account breakdown ---
  const accountBreakdown = useMemo<Record<string, AccountBreakdown[]>>(
    () =>
      engineData &&
      engineData.result &&
      "accountBreakdownByCategory" in engineData
        ? (engineData.accountBreakdownByCategory as Record<
            string,
            AccountBreakdown[]
          >)
        : {},
    [engineData],
  );

  const filteredBreakdown = useMemo(() => {
    let base = accountBreakdown;
    if (parentCategoryFilter) {
      const out: Record<string, AccountBreakdown[]> = {};
      for (const [cat, accts] of Object.entries(base)) {
        const f = accts.filter(
          (a) => a.parentCategory === parentCategoryFilter,
        );
        if (f.length > 0) out[cat] = f;
      }
      base = out;
    }
    if (!isPersonFiltered) return base;
    const out: Record<string, AccountBreakdown[]> = {};
    for (const [cat, accts] of Object.entries(base)) {
      const filtered = accts.filter((a) => a.ownerPersonId === personFilter);
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [accountBreakdown, isPersonFiltered, personFilter, parentCategoryFilter]);

  // --- Visible columns ---
  const visibleColumns = useMemo(() => {
    const contribCats = new Set<string>();
    const contribTaxTypes = new Set<string>();
    const balanceAccts = new Set<string>();
    const balanceTaxTypes = new Set<string>();
    if (result) {
      for (const yr of result.projectionByYear) {
        /* eslint-disable no-restricted-syntax -- type narrowing for dynamic engine output */
        if (
          "slots" in yr &&
          Array.isArray((yr as unknown as Record<string, unknown>).slots)
        ) {
          for (const slot of (yr as unknown as Record<string, unknown>)
            .slots as Record<string, unknown>[]) {
            /* eslint-enable no-restricted-syntax */
            const hasContrib =
              (slot.employeeContrib ?? 0) !== 0 ||
              (slot.employerMatch ?? 0) !== 0;
            const hasWithdrawal = (slot.withdrawal ?? 0) !== 0;
            if (hasContrib || hasWithdrawal) {
              const slotCat = slot.category as string;
              if (
                parentCategoryFilter &&
                slotCat in ACCOUNT_TYPE_CONFIG &&
                ACCOUNT_TYPE_CONFIG[slotCat as AccountCategory].isOverflowTarget
              ) {
                const iabs = (
                  yr as {
                    individualAccountBalances?: {
                      category: string;
                      parentCategory?: string;
                      contribution: number;
                      employerMatch: number;
                    }[];
                  }
                ).individualAccountBalances;
                const hasMatchingContrib = iabs?.some(
                  (ia) =>
                    ia.category === slotCat &&
                    ia.parentCategory === parentCategoryFilter &&
                    (ia.contribution !== 0 || ia.employerMatch !== 0),
                );
                if (hasMatchingContrib) contribCats.add(slotCat);
              } else {
                contribCats.add(slotCat);
              }
            }
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
            if (
              (hasContrib || hasWithdrawal) &&
              _singleBucketCategories.has(slot.category as string)
            ) {
              const slotCfg =
                ACCOUNT_TYPE_CONFIG[slot.category as AccountCategory];
              contribTaxTypes.add(slotCfg.taxBucketKey);
            }
          }
        }
        if (yr.balanceByAccount) {
          for (const seg of getAccountSegments()) {
            if (getSegmentBalance(yr.balanceByAccount, seg) !== 0)
              balanceAccts.add(seg.key);
          }
        }
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
  }, [result, parentCategoryFilter]);

  // --- Column labels and tooltips ---
  const columnLabel: Record<string, string> = Object.fromEntries(
    getAccountSegments().map((seg) => [seg.key, seg.label]),
  );

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
        cat in ACCOUNT_TYPE_CONFIG
          ? ACCOUNT_TYPE_CONFIG[cat as AccountCategory]
          : null;
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
        if (isTaxFreeBucket(a.taxType)) {
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

  // --- Deflation ---
  const inflationRate =
    engineSettings?.annualInflation != null
      ? Number(engineSettings.annualInflation)
      : DEFAULT_INFLATION_RATE;
  const baseYear = new Date().getFullYear();
  const deflate = (value: number, year: number) => {
    if (dollarMode === "nominal") return value;
    const years = year - baseYear;
    if (years <= 0) return value;
    return value / Math.pow(1 + inflationRate, years);
  };

  const renderTooltip = _renderTooltip;

  // --- Contribution rate schedule ---
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

  // --- Age display ---
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
      for (const yr of years) {
        if (yr.age % 5 === 0) milestones.add(yr.year);
      }
      for (let i = 1; i < years.length; i++) {
        if (years[i]!.phase !== years[i - 1]!.phase)
          milestones.add(years[i]!.year);
      }
      for (const o of accumOverrides) milestones.add(o.year);
      for (const o of decumOverrides) milestones.add(o.year);
      if (result?.firstOverflowYear) milestones.add(result.firstOverflowYear);
      if (result?.portfolioDepletionYear)
        milestones.add(result.portfolioDepletionYear);
      return years.filter((yr) => milestones.has(yr.year));
    },
    [showAllYears, accumOverrides, decumOverrides, result],
  );

  // Individual account names for lump sum targeting
  const individualAccountNames = useMemo(() => {
    const first = result?.projectionByYear?.[0];
    if (!first) return [];
    return first.individualAccountBalances
      .filter((ia) => isRetirementParent(ia.parentCategory))
      .map((ia) => ({
        name: ia.name,
        category: ia.category,
        taxType: ia.taxType,
        ownerName: ia.ownerName,
      }));
  }, [result]);

  const commonReturn = {
    engineData,
    rawResult,
    combinedSalary,
    enginePeople,
    realDefaults,
    dbSalaryOverrides,
    dbBudgetOverrides,
    primaryPersonId,
    salaryByPerson,
    salaryOverridePersonId,
    annualExpenses,
    decumulationExpenses,
    budgetProfileSummaries,
    contribProfileSummaries,
    salaryProfileSummaries,
    contribSpecs,
    rothBracketPresets,
    personFilterName,
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
    individualAccountNames,
  };

  // Discriminated on `result`: consumers that check `state.result` (property
  // access, not a pre-destructured local — TS narrowing doesn't survive
  // destructuring across a union) before reading `state.engineSettings` get
  // it typed as always-defined, no `!` needed. See callers in
  // projection-chart.tsx, projection-hero-kpis.tsx, projection-mc-results.tsx,
  // and cards/projection/index.tsx.
  if (result && engineSettings) {
    return { ...commonReturn, result, engineSettings };
  }
  return { ...commonReturn, result: null, engineSettings: undefined };
}
