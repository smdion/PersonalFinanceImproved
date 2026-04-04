"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import { categoriesWithTaxPreference } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { LoadingCard, ErrorCard } from "./utils";

export function SavingsRateCard() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
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
    200000,
  );
  const [matchOverride, setMatchOverride] = useState<boolean | null>(null);
  if (isLoading) return <LoadingCard title="Savings Rate" />;
  if (error) return <ErrorCard title="Savings Rate" message="Failed to load" />;

  const people = data?.people?.filter((d) => d.result) ?? [];
  // YTD ratio per person: scale annual amounts to elapsed periods
  const ytdRatio = (d: (typeof people)[0]) =>
    d.periodsPerYear > 0 ? d.periodsElapsedYtd / d.periodsPerYear : 0;
  const scale = (d: (typeof people)[0], annual: number) =>
    isYtd ? annual * ytdRatio(d) : annual;
  // Use totalCompensation (always includes bonus) — shared logic across all pages
  const householdTotalComp = people.reduce(
    (s, d) => s + scale(d, d.totalCompensation ?? d.salary ?? 0),
    0,
  );
  const highIncome = householdTotalComp >= highIncomeThreshold;

  // Default: exclude match for high income, include for lower income
  // User can override via toggle (matchOverride)
  const excludeMatch = matchOverride !== null ? matchOverride : highIncome;

  const totalKey = excludeMatch
    ? "totalEmployeeOnly"
    : "totalAnnualContributions";
  const jointTotal = excludeMatch
    ? (data?.jointTotals?.totalWithoutMatch ?? 0)
    : (data?.jointTotals?.totalWithMatch ?? 0);
  // Annual totals (for rate calculation)
  const totalContribsAnnual =
    people.reduce((s, d) => s + (d.result![totalKey] ?? 0), 0) + jointTotal;
  // Household average YTD ratio for joint scaling
  const avgYtdRatio =
    people.length > 0
      ? people.reduce((s, d) => s + ytdRatio(d), 0) / people.length
      : 0;
  const jointScaled = isYtd ? jointTotal * avgYtdRatio : jointTotal;
  const totalContribs = isYtd
    ? people.reduce((s, d) => s + (d.result![totalKey] ?? 0) * ytdRatio(d), 0) +
      jointScaled
    : totalContribsAnnual;

  // Household savings rate — use server-computed rates (single source of truth)
  // For annual: weighted average of per-person server rates
  // For YTD: scale annual rate by YTD fraction (same rate, different dollar amounts)
  const rateKey2 = excludeMatch
    ? "savingsRateWithoutMatch"
    : "savingsRateWithMatch";
  const annualRate =
    householdTotalComp > 0
      ? people.reduce(
          (s, d) =>
            s +
            (d.totals?.[rateKey2 as keyof typeof d.totals] ?? 0) *
              (d.totalCompensation ?? d.salary ?? 0),
          0,
        ) / householdTotalComp
      : 0;
  const totalRate = isYtd
    ? householdTotalComp > 0
      ? totalContribs / householdTotalComp
      : 0
    : annualRate;

  // Collect group totals in dollars, then compute rates against total comp
  const groupTotals: Record<string, number> = {};
  const rateKey = excludeMatch ? "groupRatesExMatch" : "groupRates";
  for (const d of people) {
    if (!d.result) continue;
    const salary = d.salary ?? 0;
    for (const [group, rate] of Object.entries(d.result[rateKey])) {
      if (group === "total") continue;
      // Convert per-person rate back to dollars using totalCompensation (same denominator used to compute the rate)
      const comp = d.totalCompensation ?? salary;
      groupTotals[group] = (groupTotals[group] ?? 0) + rate * comp;
    }
  }
  // Add joint account contributions to group totals
  for (const jat of data?.jointAccountTypes ?? []) {
    const group =
      jat.parentCategory === "Retirement" ? "retirement" : "taxable";
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
        {isYtd ? " YTD" : "/year"} of {formatCurrency(householdTotalComp)} total
        comp
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
