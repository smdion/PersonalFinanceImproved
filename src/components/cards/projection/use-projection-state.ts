/** Projection state — composes form state, data-fetching queries, and derived computations into a single hook, plus override form submission handlers that bridge them. */
import { useCallback } from "react";
import type { AccountCategory } from "@/lib/calculators/types";
import {
  buildCategoryRecord,
  getDefaultAccumulationOrder,
  getDefaultDecumulationOrder,
} from "@/lib/config/account-types";
import type { AccumOverride, DecumOverride } from "./types";
import { emptyAccumForm, emptyDecumForm } from "./types";
import { ALL_CATEGORIES } from "./utils";
import { useProjectionFormState } from "./use-projection-form-state";
import { useProjectionQueries } from "./use-projection-queries";
import { useProjectionDerived } from "./use-projection-derived";

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

export function useProjectionState(props: UseProjectionStateProps) {
  const form = useProjectionFormState();
  const queries = useProjectionQueries(form, props);
  const derived = useProjectionDerived(form, queries, props);

  // Persistent override setters — update state AND save to DB
  const setAccumOverrides = useCallback(
    (
      updater: AccumOverride[] | ((prev: AccumOverride[]) => AccumOverride[]),
    ) => {
      form.setAccumOverrides((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next.length > 0) {
          queries.saveProjectionOverrides.mutate({
            overrideType: "accumulation",
            // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
            overrides: next as unknown as Record<string, unknown>[],
          });
        } else {
          queries.clearProjectionOverrides.mutate({
            overrideType: "accumulation",
          });
        }
        return next;
      });
    },
    [form, queries],
  );

  const setDecumOverrides = useCallback(
    (
      updater: DecumOverride[] | ((prev: DecumOverride[]) => DecumOverride[]),
    ) => {
      form.setDecumOverrides((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next.length > 0) {
          queries.saveProjectionOverrides.mutate({
            overrideType: "decumulation",
            // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
            overrides: next as unknown as Record<string, unknown>[],
          });
        } else {
          queries.clearProjectionOverrides.mutate({
            overrideType: "decumulation",
          });
        }
        return next;
      });
    },
    [form, queries],
  );

  // --- Override form submission ---
  // These handlers bridge form state and derived data (personFilterName).
  const handleAddAccumOverride = useCallback(() => {
    const year = parseInt(form.accumForm.year);
    if (isNaN(year)) return;

    // Determine if this year is post-retirement (DRAW phase)
    const retAge = derived.engineSettings?.retirementAge;
    const currentAge = derived.result?.projectionByYear?.[0]?.age;
    const baseYear = new Date().getFullYear();
    const retYear =
      retAge != null && currentAge != null
        ? baseYear + (retAge - currentAge)
        : null;
    const isDrawPhase = retYear != null && year >= retYear;

    const o: AccumOverride = { year };
    if (form.accumForm.personName) o.personName = form.accumForm.personName;
    if (form.accumForm.reset) {
      o.reset = true;
    } else {
      if (form.accumForm.contributionRate !== "")
        o.contributionRate = parseFloat(form.accumForm.contributionRate) / 100;
      if (form.accumForm.routingMode !== "")
        o.routingMode = form.accumForm.routingMode as
          | "waterfall"
          | "percentage";
      const defaultOrder = getDefaultAccumulationOrder();
      if (
        form.accumForm.accountOrder.length !== defaultOrder.length ||
        form.accumForm.accountOrder.some((v, i) => v !== defaultOrder[i])
      )
        o.accountOrder = form.accumForm.accountOrder;
      const splits: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasSplits = false;
      for (const cat of ALL_CATEGORIES) {
        if (form.accumForm.accountSplits[cat] !== "") {
          splits[cat] = parseFloat(form.accumForm.accountSplits[cat]) / 100;
          hasSplits = true;
        }
      }
      if (hasSplits) o.accountSplits = splits;
      const ts: Record<string, number> = {};
      for (const [groupKey, val] of Object.entries(form.accumForm.taxSplits)) {
        if (val !== "") ts[groupKey] = parseFloat(val) / 100;
      }
      if (Object.keys(ts).length > 0) o.taxSplits = ts;
      const caps: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasCaps = false;
      for (const cat of ALL_CATEGORIES) {
        if (form.accumForm.accountCaps[cat] !== "") {
          caps[cat] = parseFloat(form.accumForm.accountCaps[cat]);
          hasCaps = true;
        }
      }
      if (hasCaps) o.accountCaps = caps;
      const ttc: Partial<Record<"traditional" | "roth", number>> = {};
      if (form.accumForm.taxTypeCaps.traditional !== "")
        ttc.traditional = parseFloat(form.accumForm.taxTypeCaps.traditional);
      if (form.accumForm.taxTypeCaps.roth !== "")
        ttc.roth = parseFloat(form.accumForm.taxTypeCaps.roth);
      if (Object.keys(ttc).length > 0) o.taxTypeCaps = ttc;
      const ls = form.accumForm.lumpSums
        .filter((e) => e.amount !== "" && parseFloat(e.amount) > 0)
        .map((e) => ({
          id: e.id,
          amount: parseFloat(e.amount),
          targetAccount: e.targetAccount,
          ...(e.targetAccountName
            ? { targetAccountName: e.targetAccountName }
            : {}),
          ...(e.taxType !== ""
            ? { taxType: e.taxType as "traditional" | "roth" }
            : {}),
          ...(e.label ? { label: e.label } : {}),
        }));
      if (ls.length > 0) o.lumpSums = ls;
    }
    if (form.accumForm.notes) o.notes = form.accumForm.notes;

    // If this year is post-retirement and has lump sums, route them to
    // decumulation overrides instead (accumulation overrides are ignored
    // during DRAW phase)
    if (isDrawPhase && o.lumpSums && o.lumpSums.length > 0) {
      const decumO: DecumOverride = {
        year,
        lumpSums: o.lumpSums,
        ...(o.notes ? { notes: o.notes } : {}),
      };
      setDecumOverrides((prev) => {
        const filtered = prev.filter((x) => x.year !== year);
        return [...filtered, decumO].sort((a, b) => a.year - b.year);
      });
    } else {
      form.setAccumOverrides((prev) => {
        const filtered = prev.filter((x) => x.year !== year);
        const next = [...filtered, o].sort((a, b) => a.year - b.year);
        queries.saveProjectionOverrides.mutate({
          overrideType: "accumulation",
          // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
          overrides: next as unknown as Record<string, unknown>[],
        });
        return next;
      });
    }
    form.setAccumForm({
      ...emptyAccumForm,
      year: String(year + 1),
      personName: form.isPersonFiltered ? derived.personFilterName : "",
    });
    form.setShowAccumForm(false);
  }, [form, derived, queries, setDecumOverrides]);

  const handleAddDecumOverride = useCallback(() => {
    const year = parseInt(form.decumForm.year);
    if (isNaN(year)) return;

    const o: DecumOverride = { year };
    if (form.decumForm.personName) o.personName = form.decumForm.personName;
    if (form.decumForm.reset) {
      o.reset = true;
    } else {
      if (form.decumForm.withdrawalRate !== "")
        o.withdrawalRate = parseFloat(form.decumForm.withdrawalRate) / 100;
      if (form.decumForm.withdrawalRoutingMode !== "")
        o.withdrawalRoutingMode = form.decumForm.withdrawalRoutingMode;
      const defaultOrder = getDefaultDecumulationOrder();
      if (
        form.decumForm.withdrawalOrder.length !== defaultOrder.length ||
        form.decumForm.withdrawalOrder.some((v, i) => v !== defaultOrder[i])
      )
        o.withdrawalOrder = form.decumForm.withdrawalOrder;
      const wsplits: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasWSplits = false;
      for (const cat of ALL_CATEGORIES) {
        if (form.decumForm.withdrawalSplits[cat] !== "") {
          wsplits[cat] = parseFloat(form.decumForm.withdrawalSplits[cat]) / 100;
          hasWSplits = true;
        }
      }
      if (hasWSplits) o.withdrawalSplits = wsplits;
      const prefs: Record<string, "traditional" | "roth"> = {};
      for (const cat of ALL_CATEGORIES) {
        if (form.decumForm.withdrawalTaxPreference[cat] !== "") {
          prefs[cat] = form.decumForm.withdrawalTaxPreference[cat] as
            | "traditional"
            | "roth";
        }
      }
      if (Object.keys(prefs).length > 0) o.withdrawalTaxPreference = prefs;
      const caps: Record<AccountCategory, number> = buildCategoryRecord(
        () => 0,
      );
      let hasWCaps = false;
      for (const cat of ALL_CATEGORIES) {
        if (form.decumForm.withdrawalAccountCaps[cat] !== "") {
          caps[cat] = parseFloat(form.decumForm.withdrawalAccountCaps[cat]);
          hasWCaps = true;
        }
      }
      if (hasWCaps) o.withdrawalAccountCaps = caps;
      const ttc: Partial<Record<"traditional" | "roth", number>> = {};
      if (form.decumForm.withdrawalTaxTypeCaps.traditional !== "")
        ttc.traditional = parseFloat(
          form.decumForm.withdrawalTaxTypeCaps.traditional,
        );
      if (form.decumForm.withdrawalTaxTypeCaps.roth !== "")
        ttc.roth = parseFloat(form.decumForm.withdrawalTaxTypeCaps.roth);
      if (Object.keys(ttc).length > 0) o.withdrawalTaxTypeCaps = ttc;
      if (form.decumForm.rothConversionTarget !== "") {
        o.rothConversionTarget = parseFloat(
          form.decumForm.rothConversionTarget,
        );
      }
      const ls = form.decumForm.lumpSums
        .filter((e) => e.amount !== "" && parseFloat(e.amount) > 0)
        .map((e) => ({
          id: e.id,
          amount: parseFloat(e.amount),
          targetAccount: e.targetAccount,
          ...(e.targetAccountName
            ? { targetAccountName: e.targetAccountName }
            : {}),
          ...(e.taxType !== ""
            ? { taxType: e.taxType as "traditional" | "roth" }
            : {}),
          ...(e.label ? { label: e.label } : {}),
        }));
      if (ls.length > 0) o.lumpSums = ls;
    }
    if (form.decumForm.notes) o.notes = form.decumForm.notes;

    form.setDecumOverrides((prev) => {
      const filtered = prev.filter((x) => x.year !== year);
      const next = [...filtered, o].sort((a, b) => a.year - b.year);
      queries.saveProjectionOverrides.mutate({
        overrideType: "decumulation",
        // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
        overrides: next as unknown as Record<string, unknown>[],
      });
      return next;
    });
    form.setDecumForm({
      ...emptyDecumForm,
      year: String(year + 1),
      personName: form.isPersonFiltered ? derived.personFilterName : "",
    });
    form.setShowDecumForm(false);
  }, [form, derived.personFilterName, queries]);

  // Flat return — preserves the existing API surface for all consumers
  return {
    // Form state (override setAccumOverrides/setDecumOverrides with persistent versions)
    ...form,
    setAccumOverrides,
    setDecumOverrides,

    // Queries + mutations
    ...queries,

    // Derived data
    ...derived,

    // Override handlers (bridge form + derived)
    handleAddAccumOverride,
    handleAddDecumOverride,
  };
}
