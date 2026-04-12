"use client";

import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { DEFAULT_HIGH_INCOME_THRESHOLD } from "@/lib/constants";
import { useScenario } from "@/lib/context/scenario-context";
import {
  categoriesWithTaxPreference,
  isRetirementParent,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { LoadingCard, ErrorCard } from "./utils";

function SavingsRateCardImpl() {
  const { viewMode } = useScenario();
  const salaryOverrides = useSalaryOverrides();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];
  const { data, isLoading, error } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const [highIncomeThreshold] = usePersistedSetting<number>(
    "high_income_threshold",
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  const [matchOverride, setMatchOverride] = useState<boolean | null>(null);
  if (isLoading) return <LoadingCard title="Savings Rate" />;
  if (error) return <ErrorCard title="Savings Rate" message="Failed to load" />;

  const people = data?.people?.filter((d) => d.result) ?? [];

  // Use totalCompensation (always includes bonus) — shared logic across all pages
  const householdTotalComp = people.reduce(
    (s, d) => s + (d.totalCompensation ?? d.salary ?? 0),
    0,
  );
  const highIncome = householdTotalComp >= highIncomeThreshold;

  // Default: exclude match for high income, include for lower income
  // User can override via toggle (matchOverride)
  const excludeMatch = matchOverride !== null ? matchOverride : highIncome;

  // Server-computed view-aware savings rate (single source of truth)
  const rateKey2 = excludeMatch
    ? "savingsRateWithoutMatch"
    : ("savingsRateWithMatch" as const);
  const totalRate =
    householdTotalComp > 0
      ? people.reduce(
          (s, d) =>
            s +
            (d.totals.views[viewMode][rateKey2] ?? 0) *
              (d.totalCompensation ?? d.salary ?? 0),
          0,
        ) / householdTotalComp
      : 0;

  // Total contributions from server view-aware totals
  const totalKey = excludeMatch ? "totalWithoutMatch" : "totalWithMatch";
  const jointTotal = excludeMatch
    ? (data?.jointTotals?.totalWithoutMatch ?? 0)
    : (data?.jointTotals?.totalWithMatch ?? 0);
  const totalContribs =
    people.reduce((s, d) => s + d.totals.views[viewMode][totalKey], 0) +
    jointTotal;

  // Derive group totals from view-aware per-person totals (single computation path)
  const retKey = excludeMatch
    ? "retirementWithoutMatch"
    : ("retirementWithMatch" as const);
  const portKey = excludeMatch
    ? "portfolioWithoutMatch"
    : ("portfolioWithMatch" as const);
  const groupTotals: Record<string, number> = {};
  for (const d of people) {
    const vt = d.totals.views[viewMode];
    groupTotals["retirement"] = (groupTotals["retirement"] ?? 0) + vt[retKey];
    groupTotals["taxable"] = (groupTotals["taxable"] ?? 0) + vt[portKey];
  }
  // Add joint account contributions to group totals
  for (const jat of data?.jointAccountTypes ?? []) {
    const group = isRetirementParent(jat.parentCategory)
      ? "retirement"
      : "taxable";
    groupTotals[group] =
      (groupTotals[group] ?? 0) +
      (excludeMatch ? jat.employeeContrib : jat.totalContrib);
  }

  // Aggregate roth vs traditional contributions for retirement accounts only (401k + IRA)
  let totalTrad = 0;
  let totalTaxFree = 0;
  for (const d of people) {
    for (const at of d.accountTypes) {
      if (
        !categoriesWithTaxPreference().includes(
          at.categoryKey as AccountCategory,
        )
      )
        continue;
      totalTrad += at.tradContrib;
      totalTaxFree += at.taxFreeContrib;
    }
  }
  const tradPct = householdTotalComp > 0 ? totalTrad / householdTotalComp : 0;
  const taxFreePct =
    householdTotalComp > 0 ? totalTaxFree / householdTotalComp : 0;

  return (
    <Card
      title={
        <>
          Savings Rate
          <HelpTip text="Percentage of total compensation (salary + bonus) directed to savings and investments. 15% is good, 20%+ is great, 25%+ puts you on track for early financial independence." />
        </>
      }
      subtitle="25% target"
      href="/paycheck"
    >
      <div className="flex items-center gap-2">
        <Metric
          value={formatPercent(totalRate, 1)}
          label={`Household savings rate${excludeMatch ? "" : " (incl. match)"}`}
        />
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMatchOverride(excludeMatch ? false : true);
          }}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            matchOverride !== null
              ? "bg-blue-100 text-blue-700 font-medium"
              : "text-faint hover:bg-surface-elevated"
          }`}
        >
          {excludeMatch ? "Incl. match" : "Excl. match"}
        </button>
      </div>
      <p className="text-xs text-faint mt-1">
        {formatCurrency(totalContribs)}
        {viewMode === "ytd"
          ? " YTD"
          : viewMode === "blended"
            ? " est."
            : "/year"}{" "}
        of {formatCurrency(householdTotalComp)} total comp
      </p>
      {excludeMatch && (
        <p className="text-xs text-amber-600 mt-1">
          Excluding employer match
          {highIncome
            ? ` (income \u2265 ${formatCurrency(highIncomeThreshold)})`
            : ""}
        </p>
      )}
      {!excludeMatch && highIncome && (
        <p className="text-xs text-amber-600 mt-1">
          Including employer match — not meaningful above{" "}
          {formatCurrency(highIncomeThreshold)} income
        </p>
      )}
      <div className="mt-3 space-y-2">
        {/* Render groups in a defined order: retirement first, then hsa, then others */}
        {[
          "retirement",
          "hsa",
          ...Object.keys(groupTotals).filter(
            (g) => g !== "retirement" && g !== "hsa",
          ),
        ].map((group) => {
          const dollars = groupTotals[group];
          if (dollars === undefined) return null;
          return (
            <div key={group}>
              <div className="flex justify-between text-sm">
                <span className="text-muted capitalize">{group}</span>
                <span className="text-primary">
                  {formatPercent(
                    householdTotalComp > 0 ? dollars / householdTotalComp : 0,
                  )}
                </span>
              </div>
              {/* Trad/Roth split under retirement */}
              {group === "retirement" &&
                (totalTrad > 0 || totalTaxFree > 0) && (
                  <div className="ml-3 mt-1 space-y-0.5 text-xs">
                    {totalTrad > 0 && (
                      <div className="flex justify-between text-muted">
                        <span>
                          {taxTypeLabel("preTax")}
                          <HelpTip text="Traditional 401k/IRA contributions. Reduces taxable income now, taxed on withdrawal in retirement." />
                        </span>
                        <span className="font-medium text-secondary">
                          {formatPercent(tradPct)}
                        </span>
                      </div>
                    )}
                    {totalTaxFree > 0 && (
                      <div className="flex justify-between text-muted">
                        <span>
                          {taxTypeLabel("taxFree")}
                          <HelpTip text="Roth 401k/IRA contributions. No tax break now, but withdrawals in retirement are tax-free." />
                        </span>
                        <span className="font-medium text-secondary">
                          {formatPercent(taxFreePct)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export const SavingsRateCard = memo(SavingsRateCardImpl);
