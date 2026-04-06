/** Memoized derived data from engine query results — person filtering, visible column detection, deflation, contribution rate schedules, tooltip rendering, and milestone-based year filtering. */
import { useMemo, useCallback, useEffect } from "react";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
} from "@/lib/calculators/types";
import {
  type AccountCategory as AcctCat,
  getAccountSegments,
  getSegmentBalance,
  getAllCategories,
  getAccountTypeConfig,
  taxTypeToSubKey,
  ACCOUNT_TYPE_CONFIG,
  isRetirementParent,
} from "@/lib/config/account-types";
import type { ProjectionFormState } from "./use-projection-form-state";
import type { ProjectionQueries } from "./use-projection-queries";
import type {
  UseProjectionStateProps,
  EngineContribRate,
  AcctBreakdown,
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
  } = form;

  const { engineQuery, contribProfilesQuery } = queries;

  const { parentCategoryFilter, people, onContributionRates } = props;

  // --- Engine data narrowing ---
  const engineData = engineQuery.data;
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
  const decumulationExpenses =
    engineData && engineData.result
      ? ((engineData.decumulationExpenses as number | undefined) ?? null)
      : null;
  const budgetProfileSummaries =
    engineData && engineData.result
      ? engineData.budgetProfileSummaries
      : undefined;
  const contribProfileSummaries = contribProfilesQuery.data;

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
  const accountBreakdown = useMemo<Record<string, AcctBreakdown[]>>(
    () =>
      engineData &&
      engineData.result &&
      "accountBreakdownByCategory" in engineData
        ? (engineData.accountBreakdownByCategory as Record<
            string,
            AcctBreakdown[]
          >)
        : {},
    [engineData],
  );

  const filteredBreakdown = useMemo(() => {
    let base = accountBreakdown;
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
                ACCOUNT_TYPE_CONFIG[slotCat as AcctCat].isOverflowTarget
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
              const slotCfg = ACCOUNT_TYPE_CONFIG[slot.category as AcctCat];
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

  // --- Deflation ---
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

  return {
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
    decumulationExpenses,
    budgetProfileSummaries,
    contribProfileSummaries,
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
    // Individual account names for lump sum targeting
    individualAccountNames: useMemo(() => {
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
    }, [result]),
  };
}
