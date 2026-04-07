"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";
import { LoadingCard } from "./utils";

export function LivingCostsCard() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const isBlended = viewMode === "blended";
  const [budgetColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const { data: budgetData, isLoading: bLoading } =
    trpc.budget.computeActiveSummary.useQuery({
      selectedColumn: budgetColumn,
    });
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const lcQueryInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
  };
  const { data: paycheckData, isLoading: pLoading } =
    trpc.paycheck.computeSummary.useQuery(
      Object.keys(lcQueryInput).length > 0 ? lcQueryInput : undefined,
    );
  const [useGross, setUseGross] = useState(false);

  if (bLoading || pLoading) return <LoadingCard title="Living Costs" />;

  const budget = budgetData?.result;
  const blendedOf = (p: NonNullable<typeof paycheckData>["people"][0]) =>
    (p as Record<string, unknown>).blendedAnnual as
      | import("@/lib/calculators/types/calculators").BlendedAnnualTotals
      | undefined;

  const netIncome =
    paycheckData?.people?.reduce((s, p) => {
      if (!p.paycheck) return s;
      if (isBlended) {
        const ba = blendedOf(p);
        return (
          s + (ba ? ba.netPay : p.paycheck.netPay * p.paycheck.periodsPerYear)
        );
      }
      const mult = isYtd
        ? p.paycheck.periodsElapsedYtd
        : p.paycheck.periodsPerYear;
      return s + p.paycheck.netPay * mult;
    }, 0) ?? 0;

  const grossIncome = isYtd
    ? (paycheckData?.people?.reduce((s, p) => {
        if (!p.paycheck) return s;
        return s + p.paycheck.gross * p.paycheck.periodsElapsedYtd;
      }, 0) ?? 0)
    : isBlended
      ? (paycheckData?.people?.reduce((s, p) => {
          if (!p.paycheck) return s;
          const ba = blendedOf(p);
          return s + (ba ? ba.gross : (p.salary ?? 0));
        }, 0) ?? 0)
      : (paycheckData?.people?.reduce((s, p) => s + (p.salary ?? 0), 0) ?? 0);
  const incomeBase = useGross ? grossIncome : netIncome;
  const incomeLabel = useGross ? "gross" : "net";

  if (!budget || incomeBase <= 0) {
    return (
      <Card title="Living Costs" href={!budget ? "/budget" : "/paycheck"}>
        <p className="text-sm text-faint">
          {!budget
            ? "Create a budget profile to compare spending against recommended ranges."
            : "Add a job on the Paycheck page to calculate living cost ratios."}
        </p>
      </Card>
    );
  }

  const categoryTotals = new Map<string, number>();
  if (budgetData?.columnMonths && budgetData.allColumnResults) {
    // Weighted mode: sum each category across all columns weighted by month count
    const cm = budgetData.columnMonths;
    for (const cat of budget.categories) {
      let annual = 0;
      for (let col = 0; col < cm.length; col++) {
        const colCat = budgetData.allColumnResults[col]?.categories?.find(
          (c: { name: string }) => c.name === cat.name,
        );
        annual += (colCat?.total ?? 0) * (cm[col] ?? 0);
      }
      categoryTotals.set(cat.name, annual);
    }
  } else {
    for (const cat of budget.categories) {
      categoryTotals.set(cat.name, cat.total * 12); // annualize monthly amounts
    }
  }

  // Resolve mapping: app_settings override → default fallback
  const savedMapping = appSettings?.find(
    (s: { key: string }) => s.key === "living_cost_mapping",
  );
  const mapping: Record<string, string[]> = savedMapping?.value
    ? (savedMapping.value as Record<string, string[]>)
    : DEFAULT_LIVING_COST_MAPPING;

  const rows = RAMSEY_RANGES.map((range) => {
    const budgetCategories = mapping[range.name] ?? [];
    const annual = budgetCategories.reduce(
      (s, bc) => s + (categoryTotals.get(bc) ?? 0),
      0,
    );
    const pct = incomeBase > 0 ? annual / incomeBase : 0;
    const status =
      pct < range.low ? "below" : pct > range.high ? "above" : "on-target";
    return {
      name: range.name,
      low: range.low,
      high: range.high,
      annual,
      pct,
      status,
    };
  }).filter((r) => r.annual > 0);

  const onTarget = rows.filter(
    (r) => r.status === "on-target" || r.status === "below",
  ).length;

  return (
    <Card
      title={
        <>
          Living Costs
          <HelpTip
            text={`Budget categories as % of ${incomeLabel} income compared to Dave Ramsey's recommended ranges. Toggle between gross and net income. Ramsey's original ranges are based on net take-home pay.`}
          />
        </>
      }
      subtitle={`${onTarget}/${rows.length} within range`}
      href="/budget"
    >
      {/* Gross / Net toggle */}
      <div
        className="flex items-center gap-2 mb-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="text-xs text-muted">% of:</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setUseGross(false);
          }}
          className={`text-xs px-2 py-0.5 rounded ${!useGross ? "bg-blue-100 text-blue-700 font-medium" : "text-muted hover:bg-surface-elevated"}`}
        >
          Net ({formatCurrency(netIncome)})
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setUseGross(true);
          }}
          className={`text-xs px-2 py-0.5 rounded ${useGross ? "bg-blue-100 text-blue-700 font-medium" : "text-muted hover:bg-surface-elevated"}`}
        >
          Gross ({formatCurrency(grossIncome)})
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="text-xs">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-muted">{r.name}</span>
              <span className="text-faint">
                <span
                  className={`font-medium ${
                    r.status === "above"
                      ? "text-red-600"
                      : r.status === "below"
                        ? "text-blue-600"
                        : "text-green-600"
                  }`}
                >
                  {formatPercent(r.pct, 0)}
                </span>{" "}
                <span className="text-faint">
                  / {formatPercent(r.low, 0)}-{formatPercent(r.high, 0)}
                </span>
              </span>
            </div>
            <div className="relative h-2 bg-surface-elevated rounded-full overflow-hidden">
              {/* Recommended range bracket (bottom layer) */}
              <div
                className="absolute h-full bg-green-100 border-l border-r border-green-300"
                style={{
                  left: `${r.low * 100}%`,
                  width: `${(r.high - r.low) * 100}%`,
                }}
              />
              {/* Actual spending bar (top layer) */}
              <div
                className={`absolute h-full rounded-full ${
                  r.status === "above"
                    ? "bg-red-400"
                    : r.status === "below"
                      ? "bg-blue-400"
                      : "bg-green-500"
                }`}
                style={{ width: `${Math.min(r.pct * 100, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500" /> On target
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400" /> Below
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400" /> Above
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-100 border border-green-200" />{" "}
          Target
        </span>
      </div>
    </Card>
  );
}
