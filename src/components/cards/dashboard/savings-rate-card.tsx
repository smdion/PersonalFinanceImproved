"use client";

import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import { sumBy } from "@/lib/utils/math";
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
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";

// A real, nonzero contribution can still round to "0%" at the default 0
// decimals (e.g. $100/mo against a $250k household income is ~0.5%), which
// reads as "nothing here" even though dollars are genuinely flowing.  Fall
// back to 1 decimal only in that specific case so small-but-real categories
// stay visible without adding decimal noise to the common (larger) values.
function formatBreakdownPercent(fraction: number): string {
  if (fraction > 0 && Math.round(fraction * 100) === 0) {
    return formatPercent(fraction, 1);
  }
  return formatPercent(fraction);
}

function SavingsRateCardImpl() {
  const { viewMode } = useScenario();
  const salaryOverrides = useSalaryOverrides();
  // Independent Salary Profile axis (Plan pin -> globally-active setting).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
    ...salaryProfileInput,
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
    sumBy(people, (d) => d.totals.views[viewMode][totalKey]) + jointTotal;

  // Derive group totals from view-aware per-person totals (single computation path)
  const retKey = excludeMatch
    ? "retirementWithoutMatch"
    : ("retirementWithMatch" as const);
  const portKey = excludeMatch
    ? "portfolioWithoutMatch"
    : ("portfolioWithMatch" as const);
  // "portfolio" here means parentCategory === "Portfolio" — i.e. accounts
  // NOT earmarked toward retirement projections. This is a goal-routing
  // split, not a tax-treatment one: a Portfolio account isn't necessarily
  // taxable, and a Retirement account isn't necessarily tax-advantaged (see
  // afterTax total below, which cuts across both).
  const groupTotals: Record<string, number> = {};
  for (const d of people) {
    const vt = d.totals.views[viewMode];
    groupTotals["retirement"] = (groupTotals["retirement"] ?? 0) + vt[retKey];
    groupTotals["portfolio"] = (groupTotals["portfolio"] ?? 0) + vt[portKey];
  }
  // Add joint account contributions to group totals
  for (const jat of data?.jointAccountTypes ?? []) {
    const group = isRetirementParent(jat.parentCategory)
      ? "retirement"
      : "portfolio";
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

  // After-tax and HSA are tax-treatment splits, not goal ones — either can
  // occur inside EITHER group above (e.g. a taxable brokerage account
  // tagged Retirement, or one tagged Portfolio), so each is tracked
  // per-group here and rendered as a sub-line under each group, the same
  // way Traditional/Roth are sub-lines under Retirement — not as its own
  // top-level sibling. Without this, group totals (which include every tax
  // treatment) won't reconcile against just Traditional+Roth.
  function sumByGroup(
    getContrib: (at: { afterTaxContrib: number; hsaContrib: number }) => number,
  ): Record<string, number> {
    const byGroup: Record<string, number> = {};
    for (const d of people) {
      for (const at of d.accountTypes) {
        const amount = getContrib(at);
        if (amount === 0) continue;
        const group = isRetirementParent(at.parentCategory)
          ? "retirement"
          : "portfolio";
        byGroup[group] = (byGroup[group] ?? 0) + amount;
      }
    }
    for (const jat of data?.jointAccountTypes ?? []) {
      const amount = getContrib(jat);
      if (amount === 0) continue;
      const group = isRetirementParent(jat.parentCategory)
        ? "retirement"
        : "portfolio";
      byGroup[group] = (byGroup[group] ?? 0) + amount;
    }
    return byGroup;
  }
  const afterTaxByGroup = sumByGroup((at) => at.afterTaxContrib);
  const hsaByGroup = sumByGroup((at) => at.hsaContrib);

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
      <div className="flex items-center justify-between mb-1">
        <Metric
          value={formatPercent(totalRate, 1)}
          label={`Household savings rate${excludeMatch ? "" : " (incl. match)"}${viewMode === "ytd" ? " — annualized YTD" : ""}`}
        />
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMatchOverride(excludeMatch ? false : true);
          }}
          className="text-xs bg-surface-elevated hover:bg-surface-strong rounded-full px-2 py-0.5 text-muted transition-colors"
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
        {/* Render groups in a defined order: retirement first, then others */}
        {[
          "retirement",
          ...Object.keys(groupTotals).filter((g) => g !== "retirement"),
        ].map((group) => {
          const dollars = groupTotals[group];
          if (dollars === undefined) return null;
          const groupAfterTax = afterTaxByGroup[group] ?? 0;
          const groupAfterTaxPct =
            householdTotalComp > 0 ? groupAfterTax / householdTotalComp : 0;
          const groupHsa = hsaByGroup[group] ?? 0;
          const groupHsaPct =
            householdTotalComp > 0 ? groupHsa / householdTotalComp : 0;
          const hasSubLines =
            (group === "retirement" && (totalTrad > 0 || totalTaxFree > 0)) ||
            groupAfterTax > 0 ||
            groupHsa > 0;
          return (
            <div key={group}>
              <div className="flex justify-between text-sm">
                <span className="text-muted capitalize">{group}</span>
                <span className="text-primary">
                  {formatBreakdownPercent(
                    householdTotalComp > 0 ? dollars / householdTotalComp : 0,
                  )}
                </span>
              </div>
              {/* Tax-treatment sub-lines — Traditional/Roth only apply to
                  Retirement (401k/IRA); After-tax can apply to either group,
                  since it's an orthogonal axis (see afterTaxByGroup above). */}
              {hasSubLines && (
                <div className="ml-3 mt-1 space-y-0.5 text-xs">
                  {group === "retirement" && totalTrad > 0 && (
                    <div className="flex justify-between text-muted">
                      <span>
                        {taxTypeLabel("preTax")}
                        <HelpTip text="Traditional 401k/IRA contributions. Reduces taxable income now, taxed on withdrawal in retirement." />
                      </span>
                      <span className="font-medium text-secondary">
                        {formatBreakdownPercent(tradPct)}
                      </span>
                    </div>
                  )}
                  {group === "retirement" && totalTaxFree > 0 && (
                    <div className="flex justify-between text-muted">
                      <span>
                        {taxTypeLabel("taxFree")}
                        <HelpTip text="Roth 401k/IRA contributions. No tax break now, but withdrawals in retirement are tax-free." />
                      </span>
                      <span className="font-medium text-secondary">
                        {formatBreakdownPercent(taxFreePct)}
                      </span>
                    </div>
                  )}
                  {groupAfterTax > 0 && (
                    <div className="flex justify-between text-muted">
                      <span>
                        After-tax
                        <HelpTip text="Taxable/brokerage contributions (taxTreatment: after-tax) within this group." />
                      </span>
                      <span className="font-medium text-secondary">
                        {formatBreakdownPercent(groupAfterTaxPct)}
                      </span>
                    </div>
                  )}
                  {groupHsa > 0 && (
                    <div className="flex justify-between text-muted">
                      <span>
                        HSA
                        <HelpTip text="HSA contributions within this group. Triple tax-advantaged — not Traditional or Roth." />
                      </span>
                      <span className="font-medium text-secondary">
                        {formatBreakdownPercent(groupHsaPct)}
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
