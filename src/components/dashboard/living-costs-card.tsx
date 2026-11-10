"use client";

import React, { useState, memo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useFullYearNote } from "@/lib/hooks/use-full-year-note";
import { Card, ProgressBar } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { StatusDot } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import {
  sumBy,
  safeDivide,
  shareScaleMax,
  shareScaleTicks,
} from "@/lib/utils/math";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { bonusSpendingNet } from "@/lib/pure/household/household-income";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";
import {
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import { LoadingCard } from "./utils";
import {
  getExtraPaycheckMonthKeys,
  isExtraPaycheckBudgetMode,
} from "@/lib/pure/paycheck/extra-paycheck-months";
import { monthKey } from "@/lib/utils/date-keys";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContributionProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { SK_BUDGET_ACTIVE_COLUMN } from "@/lib/constants/settings-keys";

type BudgetSummaryData = NonNullable<
  RouterOutputs["budget"]["computeActiveSummary"]
>;

/**
 * The budget at a glance, above the category ranges: the monthly plan,
 * essential vs discretionary, and (with a linked budget app) what's been
 * spent this month.
 */
function BudgetSummary({
  result,
  weightedAnnualTotal,
  weighted,
  actuals,
}: {
  result: NonNullable<BudgetSummaryData["result"]>;
  weightedAnnualTotal: number | null;
  weighted: boolean;
  actuals: RouterOutputs["budget"]["listApiActuals"] | undefined;
}) {
  const monthly = weighted
    ? (weightedAnnualTotal ?? 0) / 12
    : result.totalMonthly;
  const rows = actuals?.actuals ?? [];
  const budgeted = sumBy(rows, (a) => a.budgeted);
  const spent = sumBy(rows, (a) => Math.max(0, -a.activity));
  const spentShare = safeDivide(spent, budgeted, null);
  return (
    <div className="border-subtle mb-3 border-b pb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-primary text-lg font-semibold">
          {formatCurrency(monthly)}
          <span className="text-faint ml-1 text-xs font-normal">
            /month{weighted ? " avg" : ""}
          </span>
        </span>
        <span className="text-muted text-xs">
          Essential {formatCurrency(result.essentialTotal)} · Discretionary{" "}
          {formatCurrency(result.discretionaryTotal)}
        </span>
      </div>
      {actuals?.service && rows.length > 0 && spentShare !== null && (
        <div className="mt-2">
          <ProgressBar
            value={spentShare}
            label={`Spent this month${actuals.month ? ` (${formatDate(actuals.month, "short")})` : ""}`}
            tooltip={`${formatCurrency(spent)} spent of ${formatCurrency(budgeted)} budgeted (linked categories only)`}
            variant="success"
            allowOver
            small
          />
        </div>
      )}
    </div>
  );
}

function LivingCostsCardImpl() {
  const fullYearNote = useFullYearNote();
  const [budgetColumn] = usePersistedSetting<number>(
    SK_BUDGET_ACTIVE_COLUMN,
    0,
  );
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [storedActiveSalaryProfileId] = useActiveSalaryProfile();
  const {
    contributionProfileId: effectiveContributionId,
    queryInput: contributionProfileInput,
  } = useEffectiveContributionProfileId();
  // Budget Profile axis — the active row, through the shared resolver.
  const { data: budgetProfilesList } = useBudgetProfilesList();
  const globalActiveBudgetId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  const { profileId: displayBudgetProfileId } = useEffectiveProfileId(
    "budget",
    {
      validIds: budgetProfilesList?.map((p) => p.id),
      localSelection: null,
      activeProfileId: globalActiveBudgetId,
    },
  );
  const activeBudgetProfileName = budgetProfilesList?.find(
    (p) => p.id === displayBudgetProfileId,
  )?.name;
  // Same profiles as the paycheck query below, so the budget total and the
  // income figure on this card never disagree about which Salary /
  // Contribution Profile is in effect.
  const { data: budgetData, isLoading: isBudgetLoading } =
    trpc.budget.computeActiveSummary.useQuery({
      selectedColumn: budgetColumn,
      ...(displayBudgetProfileId != null
        ? { profileId: displayBudgetProfileId }
        : {}),
      selection: {
        contribution: effectiveContributionId,
        salary: storedActiveSalaryProfileId,
      },
    });
  // Spent this month in the linked budget app (YNAB/Actual) — the "how am
  // I actually doing" line next to the plan.
  const { data: actualsData } = trpc.budget.listApiActuals.useQuery();
  const lcQueryInput = {
    ...contributionProfileInput,
    ...salaryProfileInput,
  };
  const { data: paycheckData, isLoading: isPaycheckLoading } =
    trpc.paycheck.computeSummary.useQuery(
      Object.keys(lcQueryInput).length > 0 ? lcQueryInput : undefined,
    );
  // Taxes/Retirement/Portfolio/Savings — the non-budget destinations gross
  // income actually goes to, so the card can show the full picture (budget
  // categories alone never sum anywhere near 100% of gross).
  const { data: contributionData, isLoading: isContributionLoading } =
    trpc.contribution.computeSummary.useQuery(
      Object.keys(lcQueryInput).length > 0 ? lcQueryInput : undefined,
    );
  // Savings goal buckets: a destination distinct from contribution accounts and
  // not profile-scoped, so no Salary/Contribution Profile input.
  const { data: savingsData, isLoading: isSavingsLoading } =
    trpc.savings.computeSummary.useQuery();
  const { data: extraPaycheckJobs, isLoading: isExtraPaycheckLoading } =
    trpc.savings.extraPaycheckRouting.list.useQuery();
  const [useGross, setUseGross] = useState(false);

  if (
    isBudgetLoading ||
    isPaycheckLoading ||
    isContributionLoading ||
    isSavingsLoading ||
    isExtraPaycheckLoading
  )
    return <LoadingCard title="Living Costs" />;

  const budget = budgetData?.result;

  // Always full-year, whatever the Paycheck toggle: every figure but income is an annualized
  // rate, so a YTD income base would skew the percentages. Household income = salary +
  // resolved bonus, as on the Income card and in the taxes.
  const householdIncome = paycheckData?.householdIncome ?? null;
  const netIncome = householdIncome
    ? householdIncome.netRegular + householdIncome.netBonus
    : 0;
  const grossIncome = householdIncome?.gross ?? 0;
  const incomeBase = useGross ? grossIncome : netIncome;
  const incomeLabel = useGross ? "gross" : "net";

  if (!budget || incomeBase <= 0) {
    return (
      <Card title="Living Costs" href={!budget ? "/budget" : "/paycheck"}>
        <p className="text-faint text-sm">
          {!budget
            ? "Create a budget profile to compare spending against recommended ranges."
            : "Add a job on the Paycheck page to calculate living cost ratios."}
        </p>
      </Card>
    );
  }

  const categoryTotals = new Map<string, number>();
  if (budgetData.columnMonths) {
    // Weighted mode: sum each category across all columns weighted by month count
    const cm = budgetData.columnMonths;
    for (const cat of budget.categories) {
      let annual = 0;
      for (let col = 0; col < cm.length; col++) {
        const colCat = budgetData.allColumnResults[col]?.categories.find(
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

  // A budget item linked to a contribution account takes its amount from that
  // account, which the Portfolio/Retirement rows already count; net it out of
  // categoryTotals here so every downstream total sees each dollar once.
  const linkedItems = budgetData.rawItems.filter(
    (i) => i.contributionAccountId != null,
  );
  if (linkedItems.length > 0) {
    const linkedAnnualByCategory = new Map<string, number>();
    if (budgetData.columnMonths) {
      const cm = budgetData.columnMonths;
      for (const item of linkedItems) {
        let annual = 0;
        for (let col = 0; col < cm.length; col++) {
          annual += (item.contribAmounts?.[col] ?? 0) * (cm[col] ?? 0);
        }
        linkedAnnualByCategory.set(
          item.category,
          (linkedAnnualByCategory.get(item.category) ?? 0) + annual,
        );
      }
    } else {
      for (const item of linkedItems) {
        const annual = (item.contribAmount ?? 0) * 12;
        linkedAnnualByCategory.set(
          item.category,
          (linkedAnnualByCategory.get(item.category) ?? 0) + annual,
        );
      }
    }
    for (const [category, linkedAnnual] of linkedAnnualByCategory) {
      categoryTotals.set(
        category,
        Math.max((categoryTotals.get(category) ?? 0) - linkedAnnual, 0),
      );
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
    const pct = safeDivide(annual, incomeBase, 0);
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
  }).filter((r) => r.annual > 0.5);

  const onTarget = rows.filter(
    (r) => r.status === "on-target" || r.status === "below",
  ).length;

  // Taxes, contributions, savings, other spending and unallocated join the category list in
  // both modes. Net mode counts only non-payroll contributions (isPayrollDeducted, not tax
  // treatment); Gross counts all of them. Employer match is excluded from both.
  const annualTaxes = paycheckData?.householdTax?.totalTax ?? 0;
  // Non-contribution paycheck deductions (health insurance etc.) leave gross pay before net,
  // so Gross mode needs them as a row. rawDeductions excludes contribution accounts, which
  // retirementTotal/portfolioTotal already cover.
  const otherDeductionsAnnual = paycheckData?.people
    ? sumBy(paycheckData.people, (p) =>
        p.paycheck
          ? sumBy(p.rawDeductions, (d) => Number(d.amountPerPeriod)) *
            p.paycheck.periodsPerYear
          : 0,
      )
    : 0;
  const contributionPeople = contributionData?.people ?? [];
  const contributionJoint = contributionData?.jointAccountTypes ?? [];
  const allAccountTypes = [
    ...contributionPeople.flatMap((p) => p.accountTypes),
    ...contributionJoint,
  ];
  const retirementTypes = allAccountTypes.filter((a) =>
    isRetirementParent(a.parentCategory),
  );
  const portfolioTypes = allAccountTypes.filter((a) =>
    isPortfolioParent(a.parentCategory),
  );
  const retirementNonPayroll = sumBy(
    retirementTypes,
    (a) => a.nonPayrollContrib,
  );
  const portfolioNonPayroll = sumBy(portfolioTypes, (a) => a.nonPayrollContrib);
  const jointRetirementNoMatch = sumBy(
    contributionJoint.filter((a) => isRetirementParent(a.parentCategory)),
    (a) => a.employeeContrib,
  );
  const jointPortfolioNoMatch = sumBy(
    contributionJoint.filter((a) => isPortfolioParent(a.parentCategory)),
    (a) => a.employeeContrib,
  );
  // "projected" (not viewMode) — same full-year-always rule as netIncome/
  // grossIncome above.
  const retirementTotal =
    sumBy(
      contributionPeople,
      (p) => p.totals.views.projected.retirementWithoutMatch,
    ) + jointRetirementNoMatch;
  const portfolioTotal =
    sumBy(
      contributionPeople,
      (p) => p.totals.views.projected.portfolioWithoutMatch,
    ) + jointPortfolioNoMatch;
  // Unallocated uses ALL budget categories (not just the Ramsey-mapped
  // ones shown as their own rows above) — a category with no Ramsey
  // mapping still counts as spent, it just doesn't get its own labeled row.
  const totalBudgetSpending = sumBy(budget.categories, (cat) =>
    Math.max(categoryTotals.get(cat.name) ?? 0, 0),
  );
  const annualSavings =
    sumBy(savingsData?.savings.goals ?? [], (g) => g.monthlyAllocation) * 12;
  // Extra-paycheck money routed to savings isn't in any goal's monthlyAllocation, so add it.
  // Counted from this year's 3rd-paycheck months times the current toggle, not from the
  // materialized transactions, which miss months that passed before a rule existed.
  const thisYear = new Date().getFullYear();
  const extraPaycheckAllocatedThisYear = sumBy(extraPaycheckJobs ?? [], (j) => {
    if (j.payPeriod !== "biweekly" || !j.anchorPayDate) return 0;
    const routing = j.extraPaycheckRouting;
    if (isExtraPaycheckBudgetMode(routing)) return 0;
    const netPayPerCheck = routing?.baseNetPayPerCheck ?? 0;
    if (netPayPerCheck <= 0) return 0;
    const anchor = new Date(j.anchorPayDate + "T00:00:00Z");
    const extraMonthsThisYear = getExtraPaycheckMonthKeys(
      anchor,
      j.payPeriod,
      monthKey(new Date(thisYear, 0, 1)),
      12,
    );
    return extraMonthsThisYear.length * netPayPerCheck;
  });
  // Take-home of bonuses set to "extra spending" (their taxes and contributions
  // are in the other bars); same in both modes. Each job's Salary Profile entry
  // says where its bonus goes.
  const bonusShown = bonusSpendingNet(
    (paycheckData?.people ?? []).map((p) => ({
      netBonus: p.earnings?.netBonus ?? 0,
      bonusDestination: "bonusDestination" in p ? p.bonusDestination : "budget",
    })),
  );
  const retirementShown = useGross ? retirementTotal : retirementNonPayroll;
  const portfolioShown = useGross ? portfolioTotal : portfolioNonPayroll;
  const unallocated = Math.max(
    incomeBase -
      (useGross ? annualTaxes : 0) -
      (useGross ? otherDeductionsAnnual : 0) -
      retirementShown -
      portfolioShown -
      annualSavings -
      extraPaycheckAllocatedThisYear -
      bonusShown -
      totalBudgetSpending,
    0,
  );
  const extraGrossRows = [
    ...(useGross
      ? [{ name: "Taxes", annual: annualTaxes, color: "bg-red-400" }]
      : []),
    ...(useGross && otherDeductionsAnnual > 0
      ? [
          {
            name: "Other Paycheck Deductions",
            annual: otherDeductionsAnnual,
            color: "bg-orange-400",
          },
        ]
      : []),
    { name: "Retirement", annual: retirementShown, color: "bg-purple-400" },
    { name: "Portfolio", annual: portfolioShown, color: "bg-indigo-400" },
    { name: "Savings", annual: annualSavings, color: "bg-teal-400" },
    {
      name: "Extra Paycheck",
      annual: extraPaycheckAllocatedThisYear,
      color: "bg-cyan-400",
    },
    {
      name: "Bonus (extra spending)",
      annual: bonusShown,
      color: "bg-amber-300",
    },
    { name: "Unallocated", annual: unallocated, color: "bg-surface-strong" },
  ]
    .map((r) => ({ ...r, pct: safeDivide(r.annual, incomeBase, 0) }))
    // A half-dollar floor, not `> 0`: floating-point subtraction upstream can
    // leave a sub-cent residue that would render as "0% ($0.00)".
    .filter((r) => r.annual > 0.5);
  // Display check: Unallocated absorbs the rest, so this lands near 100%, except under
  // over-allocation, where Unallocated's $0 floor makes the total undercount on purpose.
  const totalPercent =
    sumBy(rows, (r) => r.pct) + sumBy(extraGrossRows, (r) => r.pct);

  // Every bar shares one scale, sized to the largest share or range top in
  // the card (rounded up to the next 10%) — not 0–100%, where a 13% share
  // hugs the left edge.
  const scaleMax = shareScaleMax([
    ...rows.flatMap((r) => [r.pct, r.high]),
    ...extraGrossRows.map((r) => r.pct),
  ]);
  const barWidth = (share: number) =>
    Math.min(Math.max(share, 0) / scaleMax, 1) * 100;

  return (
    <Card
      title={
        <>
          Budget &amp; Spending
          <HelpTip
            text={`Always shows the full-year projected picture, regardless of the header's View (Projected / Year-end estimate / Year to date) — every number here besides income (budget spending, savings, retirement, portfolio, extra-paycheck routing) is this app's annualized RATE for that thing, not a real posted-transaction year-to-date total, so scoping just the income side to "so far this year" would push every percentage well past 100%. Budget categories as % of ${incomeLabel} income compared to Dave Ramsey's recommended ranges (Ramsey's original ranges are based on net take-home pay). Retirement/Portfolio/Savings/Extra Paycheck/Bonus/Unallocated below show where the rest of your ${incomeLabel} income goes: Net counts only non-payroll contributions (IRA, manually-funded brokerage/HSA) actually funded from take-home pay — payroll-deducted contributions, Roth included, never touch net pay; Gross counts your full contribution total, payroll and non-payroll combined, plus taxes and any other payroll deduction (health/dental/vision insurance, etc.) — those already come out before net pay is computed too, so Gross names them explicitly instead of leaving them invisibly baked into Net. Extra Paycheck is this year's 3rd-biweekly-paycheck months currently set to route to a savings goal (see the Savings/Budget toggle on Salary Profile or the Paycheck page) — computed from the real pay calendar, not from which months have already been transferred. Bonus is the take-home of any bonus set to \"Extra spending\" on the Paycheck page. Unallocated includes any budget category with no Ramsey mapping, plus any genuinely untracked money.`}
          />
        </>
      }
      subtitle={`${onTarget} of ${rows.length} at or under range${
        activeBudgetProfileName ? ` · ${activeBudgetProfileName}` : ""
      } · ${fullYearNote ?? "full-year view"}`}
      href="/budget"
    >
      <BudgetSummary
        result={budgetData.result}
        weightedAnnualTotal={budgetData.weightedAnnualTotal}
        weighted={!!budgetData.columnMonths}
        actuals={actualsData}
      />
      {/* Gross / Net toggle */}
      <div
        className="mb-2 flex items-center gap-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="text-muted text-xs">% of:</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setUseGross(false);
          }}
          className={`rounded px-2 py-0.5 text-xs ${!useGross ? "bg-blue-100 font-medium text-blue-700" : "text-muted hover:bg-surface-elevated"}`}
        >
          Net ({formatCurrency(netIncome)})
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setUseGross(true);
          }}
          className={`rounded px-2 py-0.5 text-xs ${useGross ? "bg-blue-100 font-medium text-blue-700" : "text-muted hover:bg-surface-elevated"}`}
        >
          Gross ({formatCurrency(grossIncome)})
        </button>
      </div>
      {/* One shared scale for every bar: lengths compare across the card. */}
      <div
        className="text-micro text-faint relative mb-1 h-3"
        aria-label={`Bars run from 0 to ${formatPercent(scaleMax, 0)} of ${incomeLabel} income`}
      >
        {shareScaleTicks(scaleMax).map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${barWidth(t)}%` }}
          >
            {formatPercent(t, 0)}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="text-xs">
            <div className="mb-0.5 flex items-center justify-between">
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
            <div className="bg-surface-elevated relative h-2 overflow-hidden rounded-full">
              {/* Recommended range bracket (bottom layer) */}
              <div
                className="absolute h-full border-r border-l border-green-300 bg-green-100"
                style={{
                  left: `${barWidth(r.low)}%`,
                  width: `${barWidth(r.high) - barWidth(r.low)}%`,
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
                style={{ width: `${barWidth(r.pct)}%` }}
              />
            </div>
          </div>
        ))}
        {extraGrossRows.length > 0 && (
          <div className="border-subtle mt-1 space-y-2 border-t pt-2">
            {extraGrossRows.map((r) => (
              <div key={r.name} className="text-xs">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-muted">{r.name}</span>
                  <span className="text-faint">
                    <span className="text-primary font-medium">
                      {formatPercent(r.pct, 0)}
                    </span>{" "}
                    <span className="text-faint">
                      ({formatCurrency(r.annual)})
                    </span>
                  </span>
                </div>
                <div className="bg-surface-elevated h-2 overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full ${r.color}`}
                    style={{ width: `${barWidth(r.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {extraGrossRows.length > 0 && (
        <p className="text-micro text-faint mt-1 text-right">
          Total: {formatPercent(totalPercent, 0)} of {incomeLabel}
        </p>
      )}
      <div className="text-caption text-faint mt-2 flex gap-3">
        <span className="flex items-center gap-1">
          <StatusDot color="green" /> On target
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-400" /> Below
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-400" /> Above
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-green-200 bg-green-100" />{" "}
          Target
        </span>
        {bonusShown > 0.5 && (
          // One home for this choice: the Bonus section on the Paycheck
          // page. (Plain text — the whole card is already a link.)
          <span>Bonus as extra spending: set per person on Paycheck</span>
        )}
        {extraGrossRows.length > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <HelpTip
              text={`Retirement/Portfolio/Savings/Extra Paycheck/Unallocated${useGross ? "/Taxes/Other Paycheck Deductions" : ""} (below the Target legend) have no recommended range — they're shown so ${incomeLabel} income is fully accounted for, not just Ramsey-mapped budget spending. Employer match is excluded since it isn't part of your own income.`}
            />
          </span>
        )}
      </div>
    </Card>
  );
}

export const LivingCostsCard = memo(LivingCostsCardImpl);
