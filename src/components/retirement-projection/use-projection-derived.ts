/** Memoized derived data from engine query results — person filtering, visible column detection, deflation, contribution rate schedules, tooltip rendering, and milestone-based year filtering. */
import {
  planAgeLabel,
  yearOfPlanAge,
} from "@/lib/pure/household/household-timeline";
import { useFocusMatch } from "@/lib/hooks/use-focus";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { useMemo, useCallback, useEffect } from "react";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
} from "@/lib/pure/engine/types";
import {
  type AccountCategory,
  getAccountSegments,
  getAllCategories,
  getAccountTypeConfig,
  taxTypeToSubKey,
  ACCOUNT_TYPE_CONFIG,
  isRetirementParent,
  isTaxFreeBucket,
  isOverflowTarget,
} from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/config/account-balance";
import { emptyTaxBucketMap } from "@/lib/config/tax-treatment-buckets";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import { DEFAULT_INFLATION_RATE } from "@/lib/constants";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { ProjectionQueries } from "./use-projection-queries";
import type {
  UseProjectionStateProps,
  EngineContributionRate,
  AccountBreakdown,
} from "./use-projection-state";
import { renderTooltip as _renderTooltip } from "./tooltip-renderer";
import {
  ROTH_CONVERSION_BRACKET_PRESETS,
  _singleBucketCategories,
  filterYearByParentCategory,
} from "./utils";

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
    projectionView,
  } = form;

  const {
    engineQuery,
    contributionProfilesQuery,
    salaryProfilesQuery,
    activeAltMcResult,
  } = queries;

  const { parentCategoryFilter, people, onContributionRates } = props;

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
    // Rate-Seeded (Feature B) and Coast FIRE Custom Age both join the same
    // swap Coast FIRE (found/today) already uses — all source their
    // deterministic line from their own MonteCarloResult rather than the
    // baseline engineQuery, via the shared activeAltMcResult selector
    // (use-projection-queries.ts).
    if (
      (projectionView === "coastFire" ||
        projectionView === "coastFireToday" ||
        projectionView === "coastFireCustom" ||
        projectionView === "rateSeeded") &&
      activeAltMcResult?.deterministicProjection
    ) {
      return activeAltMcResult.deterministicProjection;
    }
    return engineData.result;
  }, [
    projectionView,
    activeAltMcResult?.deterministicProjection,
    engineData?.result,
  ]);
  const result = useMemo(() => {
    if (!rawResult || !parentCategoryFilter) return rawResult;
    return {
      ...rawResult,
      projectionByYear: rawResult.projectionByYear.map((yearRow) =>
        filterYearByParentCategory(yearRow, parentCategoryFilter),
      ),
    };
  }, [rawResult, parentCategoryFilter]);

  // MC "Simple" tax mode (the client default) collapses per-account
  // balances into one fictional bucket server-side — a scenario sourced
  // from an MC result under that mode (Rate-Seeded today, potentially
  // others later) has NO real per-account data at all. Computed once here
  // so every consumer (person-filter pills, visibleColumns' balance-by-
  // tax-type/account gating below) reads the same signal instead of each
  // re-deriving it (showing a fake
  // "everything in Brokerage" breakdown as if it were the real account
  // split was actively misleading, not just an unfamiliar simplification).
  const hasIndividualAccountData = !!result?.projectionByYear.some(
    (y) => (y.individualAccountBalances?.length ?? 0) > 0,
  );

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
  const enginePerPersonSettings =
    engineData && engineData.result ? engineData.perPersonSettings : undefined;
  const annualExpenses =
    engineData && engineData.result ? engineData.annualExpenses : 0;

  const decumulationExpenses =
    engineData && engineData.result
      ? ((engineData.decumulationExpenses as number | undefined) ?? null)
      : null;
  const budgetProfileSummaries =
    engineData && engineData.result
      ? engineData.budgetProfileSummaries
      : undefined;
  const contributionProfileSummaries = contributionProfilesQuery.data;
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
    (yearRow: EngineYearProjection) => {
      if (!isPersonFiltered) return null;
      const iabs = yearRow.individualAccountBalances ?? [];
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
      const byCategoryContribution: Record<
        string,
        { employee: number; match: number }
      > = {};
      for (const ia of mine) {
        const cat = ia.category;
        if (!byCategoryContribution[cat])
          byCategoryContribution[cat] = { employee: 0, match: 0 };
        byCategoryContribution[cat].employee += ia.contribution;
        byCategoryContribution[cat].match += ia.employerMatch;
      }
      return {
        balance,
        contribution,
        growth,
        byTaxType,
        byAccount,
        byCategoryContribution,
      };
    },
    [isPersonFiltered, personFilter],
  );

  const personDepletionInfo = (() => {
    if (!isPersonFiltered || !result) return null;
    for (const yearRow of result.projectionByYear) {
      if (yearRow.phase !== "decumulation") continue;
      const iabs = yearRow.individualAccountBalances ?? [];
      const mine = iabs.filter((ia) => ia.ownerPersonId === personFilter);
      const balance = mine.reduce((s, ia) => s + ia.balance, 0);
      if (balance <= 0) return { year: yearRow.year, age: yearRow.age };
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
      for (const [cat, accounts] of Object.entries(base)) {
        const f = accounts.filter(
          (a) => a.parentCategory === parentCategoryFilter,
        );
        if (f.length > 0) out[cat] = f;
      }
      base = out;
    }
    if (!isPersonFiltered) return base;
    const out: Record<string, AccountBreakdown[]> = {};
    for (const [cat, accounts] of Object.entries(base)) {
      const filtered = accounts.filter((a) => a.ownerPersonId === personFilter);
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [accountBreakdown, isPersonFiltered, personFilter, parentCategoryFilter]);

  // --- Visible columns ---
  const visibleColumns = useMemo(() => {
    const contributionCats = new Set<string>();
    const contributionTaxTypes = new Set<string>();
    const balanceAccounts = new Set<string>();
    const balanceTaxTypes = new Set<string>();
    if (result) {
      for (const yearRow of result.projectionByYear) {
        /* eslint-disable no-restricted-syntax -- type narrowing for dynamic engine output */
        if (
          "slots" in yearRow &&
          Array.isArray((yearRow as unknown as Record<string, unknown>).slots)
        ) {
          for (const slot of (yearRow as unknown as Record<string, unknown>)
            .slots as Record<string, unknown>[]) {
            /* eslint-enable no-restricted-syntax */
            const hasContribution =
              (slot.employeeContrib ?? 0) !== 0 ||
              (slot.employerMatch ?? 0) !== 0;
            const hasWithdrawal = (slot.withdrawal ?? 0) !== 0;
            if (hasContribution || hasWithdrawal) {
              const slotCat = slot.category as string;
              if (
                parentCategoryFilter &&
                slotCat in ACCOUNT_TYPE_CONFIG &&
                isOverflowTarget(slotCat as AccountCategory)
              ) {
                const iabs = (
                  yearRow as {
                    individualAccountBalances?: {
                      category: string;
                      parentCategory?: string;
                      contribution: number;
                      employerMatch: number;
                      draw?: { withdrawal: number };
                    }[];
                  }
                ).individualAccountBalances;
                const hasMatchingContribution = iabs?.some(
                  (ia) =>
                    ia.category === slotCat &&
                    ia.parentCategory === parentCategoryFilter &&
                    (ia.contribution !== 0 ||
                      ia.employerMatch !== 0 ||
                      (ia.draw?.withdrawal ?? 0) !== 0),
                );
                if (hasMatchingContribution) contributionCats.add(slotCat);
              } else {
                contributionCats.add(slotCat);
              }
            }
            if (
              (slot.traditionalContrib ?? 0) !== 0 ||
              (slot.traditionalWithdrawal ?? 0) !== 0
            )
              contributionTaxTypes.add("preTax");
            if (
              (slot.rothContrib ?? 0) !== 0 ||
              (slot.rothWithdrawal ?? 0) !== 0
            )
              contributionTaxTypes.add("taxFree");
            if (
              (hasContribution || hasWithdrawal) &&
              _singleBucketCategories.has(slot.category as string)
            ) {
              const slotCfg =
                ACCOUNT_TYPE_CONFIG[slot.category as AccountCategory];
              contributionTaxTypes.add(slotCfg.taxBucketKey);
            }
          }
        }
        // Without individual-account data (MC Simple tax mode) the
        // per-account and per-tax-type figures are one collapsed bucket, so
        // only the Balance total shows (hasIndividualAccountData above).
        if (hasIndividualAccountData) {
          if (yearRow.balanceByAccount) {
            for (const seg of getAccountSegments()) {
              if (getSegmentBalance(yearRow.balanceByAccount, seg) !== 0)
                balanceAccounts.add(seg.key);
            }
          }
          if (yearRow.balanceByTaxType) {
            const bt = yearRow.balanceByTaxType;
            if (bt.preTax !== 0) balanceTaxTypes.add("preTax");
            if (bt.taxFree !== 0) balanceTaxTypes.add("taxFree");
            if (bt.hsa !== 0) balanceTaxTypes.add("hsa");
            if (bt.afterTax !== 0) balanceTaxTypes.add("afterTax");
          }
        }
      }
    }
    return {
      contributionCats,
      contributionTaxTypes,
      balanceAccounts,
      balanceTaxTypes,
    };
  }, [result, parentCategoryFilter, hasIndividualAccountData]);

  // --- Column labels and tooltips ---
  const columnLabel: Record<string, string> = Object.fromEntries(
    getAccountSegments().map((seg) => [seg.key, seg.label]),
  );

  const contributionHeaderTooltip = useMemo(() => {
    const tips: Record<string, string> = {};
    for (const cat of getAllCategories()) {
      const accounts = filteredBreakdown[cat];
      if (accounts && accounts.length > 0) {
        const names = accounts.map((a) => a.name).join(",");
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
    for (const [cat, accounts] of Object.entries(filteredBreakdown)) {
      const cfg =
        cat in ACCOUNT_TYPE_CONFIG
          ? ACCOUNT_TYPE_CONFIG[cat as AccountCategory]
          : null;
      for (const a of accounts) {
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
  const deflator = flatDeflator(baseYear, inflationRate);
  const deflate = (value: number, year: number) =>
    dollarMode === "nominal" ? value : toTodaysDollars(value, year, deflator);

  const renderTooltip = _renderTooltip;

  // --- Contribution rate schedule ---
  useEffect(() => {
    if (!onContributionRates || !result) {
      onContributionRates?.([]);
      return;
    }
    const rates: EngineContributionRate[] = [];
    let prevRate: number | null = null;
    for (const yearRow of result.projectionByYear) {
      if (yearRow.phase !== "accumulation") break;
      const r = (yearRow as EngineAccumulationYear).config.contributionRate;
      if (r !== prevRate) {
        rates.push({ year: yearRow.year, rate: r });
        prevRate = r;
      }
    }
    onContributionRates(rates);
  }, [result, onContributionRates]);

  // Each person's age in a year: the plan runs on years, and an age means
  // something different for each person.
  const agesInYear = (year: number) =>
    (people ?? enginePeople ?? []).map((p) => ({
      name: p.name,
      age: year - p.birthYear,
    }));

  const planAges = result?.projectionByYear[0];
  const primaryName = (people ?? enginePeople)?.find(
    (p) => p.id === primaryPersonId,
  )?.name;
  /** A plan age as its year and whose age it is. */
  const ageLabel = (age: number) =>
    planAges ? planAgeLabel(planAges, primaryName, age) : `Age ${age}`;
  /** A plan age's calendar year. */
  const yearOfAge = (age: number) =>
    planAges ? yearOfPlanAge(planAges, age) : age;

  const focusedYear = useFocusMatch("projectionYear")?.year ?? null;

  // --- Milestone filtering ---
  const getFilteredYears = useCallback(
    (years: EngineYearProjection[]) => {
      if (showAllYears) return years;
      if (years.length === 0) return [];
      const milestones = new Set<number>();
      milestones.add(years[0]!.year);
      milestones.add(years[years.length - 1]!.year);
      for (const yearRow of years) {
        if (yearRow.year % 5 === 0) milestones.add(yearRow.year);
      }
      for (let i = 1; i < years.length; i++) {
        if (years[i]!.phase !== years[i - 1]!.phase)
          milestones.add(years[i]!.year);
      }
      for (const o of accumOverrides) milestones.add(o.year);
      for (const o of decumOverrides) milestones.add(o.year);
      if (result?.firstOverflowYear) milestones.add(result.firstOverflowYear);
      const failureYear = result ? assessPlan(result).failureYear : null;
      if (failureYear) milestones.add(failureYear);
      // A link to one year shows that year too.
      if (focusedYear !== null) milestones.add(focusedYear);
      return years.filter((yearRow) => milestones.has(yearRow.year));
    },
    [showAllYears, accumOverrides, decumOverrides, result, focusedYear],
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
    hasIndividualAccountData,
    combinedSalary,
    enginePeople,
    enginePerPersonSettings,
    realDefaults,
    dbSalaryOverrides,
    dbBudgetOverrides,
    primaryPersonId,
    salaryByPerson,
    salaryOverridePersonId,
    annualExpenses,
    decumulationExpenses,
    budgetProfileSummaries,
    contributionProfileSummaries,
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
    contributionHeaderTooltip,
    balanceHeaderTooltip,
    inflationRate,
    baseYear,
    deflate,
    renderTooltip,
    agesInYear,
    ageLabel,
    primaryName,
    yearOfAge,
    getFilteredYears,
    individualAccountNames,
  };

  // Discriminated on `result`: consumers that check `state.result` (property
  // access, not a pre-destructured local — TS narrowing doesn't survive
  // destructuring across a union) before reading `state.engineSettings` get
  // it typed as always-defined, no `!` needed. See callers in
  // projection-chart.tsx, projection-hero-kpis.tsx, projection-mc-results.tsx,
  // and retirement-projection/index.tsx.
  if (result && engineSettings) {
    return { ...commonReturn, result, engineSettings };
  }
  return { ...commonReturn, result: null, engineSettings: undefined };
}
