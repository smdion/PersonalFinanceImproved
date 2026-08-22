"use client";

import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
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
} from "@/lib/calculators/paycheck";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";

function LivingCostsCardImpl() {
  const [budgetColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const { data: appSettings } = trpc.settings.appSettings.list.useQuery();
  const salaryActiveFields = useActiveSalaries();
  // Independent Salary Profile axis (Plan pin -> globally-active setting).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [rawActiveSalaryProfileId] = useActiveSalaryProfile();
  const { data: salaryProfilesList } = trpc.salaryProfile.list.useQuery();
  const { planPinId: planSalaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfilesList?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: rawActiveSalaryProfileId,
  });
  const {
    contributionProfileId: activeContribProfileId,
    queryInput: contribProfileInput,
  } = useEffectiveContribProfileId();
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();
  const { planPinId: planContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribProfileId,
    },
  );
  // Budget Profile axis (Plan pin -> globally-active row) — without this,
  // the card always shows the globally-active budget profile regardless of
  // what a Plan pins or what the top bar just switched to.
  const { data: budgetProfilesList } = useBudgetProfilesList();
  const globalActiveBudgetId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  const { profileId: displayBudgetProfileId, isPinned: isBudgetPinned } =
    useEffectiveProfileId("budget", {
      validIds: budgetProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: globalActiveBudgetId,
    });
  const activeBudgetProfileName = budgetProfilesList?.find(
    (p) => p.id === displayBudgetProfileId,
  )?.name;
  // Same tiers used by the paycheck query below, so the budget total and the
  // income figure on this card never disagree about which Plan-pinned
  // Salary/Contribution Profile is in effect.
  const { data: budgetData, isLoading: isBudgetLoading } =
    trpc.budget.computeActiveSummary.useQuery({
      selectedColumn: budgetColumn,
      ...(displayBudgetProfileId != null
        ? { profileId: displayBudgetProfileId }
        : {}),
      contributionProfile: {
        planPinId: planContribProfileId,
        localSelectionId: null,
        globalDefaultId: activeContribProfileId,
      },
      salaryProfile: {
        planPinId: planSalaryProfileId,
        localSelectionId: null,
        globalDefaultId: rawActiveSalaryProfileId,
      },
      ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    });
  const lcQueryInput = {
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...contribProfileInput,
    ...salaryProfileInput,
  };
  const { data: paycheckData, isLoading: isPaycheckLoading } =
    trpc.paycheck.computeSummary.useQuery(
      Object.keys(lcQueryInput).length > 0 ? lcQueryInput : undefined,
    );
  // Taxes/Retirement/Portfolio/Savings — the non-budget destinations gross
  // income actually goes to, so the card can show the full picture (budget
  // categories alone never sum anywhere near 100% of gross).
  const { data: contribData, isLoading: isContribLoading } =
    trpc.contribution.computeSummary.useQuery(
      Object.keys(lcQueryInput).length > 0 ? lcQueryInput : undefined,
    );
  // Savings goal buckets (e-fund, house, vacation, etc.) — a distinct
  // destination from Retirement/Portfolio contribution accounts above,
  // doesn't take a Salary/Contribution Profile input (savings goals aren't
  // profile-scoped the way contribution accounts are).
  const { data: savingsData, isLoading: isSavingsLoading } =
    trpc.savings.computeSummary.useQuery();
  const { data: extraPaycheckJobs, isLoading: isExtraPaycheckLoading } =
    trpc.savings.extraPaycheckRouting.list.useQuery();
  const [useGross, setUseGross] = useState(false);

  if (
    isBudgetLoading ||
    isPaycheckLoading ||
    isContribLoading ||
    isSavingsLoading ||
    isExtraPaycheckLoading
  )
    return <LoadingCard title="Living Costs" />;

  const budget = budgetData?.result;

  // Always the full-year projected figure, regardless of the Paycheck
  // page's Current Salary / Year-End Estimate / Actual YTD toggle. This
  // card's whole premise is a % of income breakdown, and only income
  // (netIncome/grossIncome) is capable of being scoped to "so far this
  // year" (periodsElapsedYtd) — every other number on this card (budget
  // spending, savings, retirement, portfolio, extra-paycheck routing) is
  // this app's ANNUALIZED RATE for that thing (a monthly budget × 12, a
  // contribution %, a goal's steady-state allocation), never a real
  // posted-transaction YTD total. Scoping only the denominator to YTD while
  // every numerator stays full-year is what produced percentages well over
  // 100% in YTD mode — not a bug in any one number, but a structural
  // mismatch between what this card can and can't actually measure. Genuine
  // YTD support would need real per-category/contribution/goal actuals
  // this app doesn't track uniformly; until then, this card intentionally
  // always shows the full-year view (see the note rendered near the toggle
  // below).
  const netIncome = paycheckData?.people
    ? sumBy(paycheckData.people, (p) =>
        p.paycheck ? p.paycheck.netPay * p.paycheck.periodsPerYear : 0,
      )
    : 0;

  const grossIncome = paycheckData?.people
    ? sumBy(paycheckData.people, (p) => p.salary ?? 0)
    : 0;
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

  // A budget item linked to a contribution account (rawItems[].
  // contributionAccountId) resolves its dollar amount FROM that account —
  // resolveLinkedBudgetItemAmounts, same mechanism the Budget page itself
  // uses. That dollar figure is already counted once in the Portfolio/
  // Retirement rows below (drawn straight from contribution.computeSummary)
  // — leaving it in categoryTotals too would double-count it as BOTH budget
  // spending and a contribution. Net it out here, at the source, so every
  // downstream total (Ramsey rows, Unallocated) only ever sees each dollar
  // once.
  const linkedItems = (budgetData?.rawItems ?? []).filter(
    (i) => i.contributionAccountId != null,
  );
  if (linkedItems.length > 0) {
    const linkedAnnualByCategory = new Map<string, number>();
    if (budgetData?.columnMonths && budgetData.allColumnResults) {
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

  // Append taxes/retirement/portfolio/savings/other-budget-spending/
  // unallocated to the SAME list the budget categories render in, in BOTH
  // modes — budget categories alone never sum anywhere near 100% of either
  // income base. No target range on these — Ramsey's ranges don't cover
  // taxes/savings/debt.
  //
  // The two modes show genuinely different numbers, not just a rescaled
  // percentage — and the axis that matters is isPayrollDeducted, NOT tax
  // treatment. A Roth 401k is post-tax but still deducted from the
  // paycheck before net pay is computed, exactly like a Traditional 401k —
  // neither ever reaches net take-home pay. Only non-payroll contributions
  // (IRA, manually-funded brokerage/HSA) are genuinely money that WAS net
  // income before you moved it — see nonPayrollContrib/payrollDeductedContrib
  // on AccountTypeSnapshot (contribution.ts), which resolve this the same
  // way paycheck.ts's calculator input does. Net mode counts only the
  // non-payroll portion; Gross mode counts the full total (both), since
  // both ultimately draw from gross. Employer match is excluded from both —
  // it isn't part of YOUR income, so including it would push either
  // allocation past 100%.
  const annualTaxes = paycheckData?.householdTax?.totalTax ?? 0;
  // Health/dental/vision/etc. paycheck deductions — money that leaves gross
  // pay before net pay is computed (see calculatePaycheck's preTaxDeductions/
  // postTaxDeductions), same as taxes and payroll-deducted retirement, but
  // with no row of its own until now. netIncome (above) already has these
  // baked out, so omitting them here was silently overstating Gross-mode
  // Unallocated by exactly this amount while Net mode stayed correct.
  // rawDeductions is the profile-resolved paycheck_deductions rows (health
  // insurance, etc.) BEFORE they're merged with contribution accounts into
  // preTaxDeductions/postTaxDeductions server-side — using it (not those
  // merged arrays) avoids double-counting the 401k/HSA contributions
  // retirementTotal/portfolioTotal already cover.
  const otherDeductionsAnnual = paycheckData?.people
    ? sumBy(paycheckData.people, (p) =>
        p.paycheck
          ? sumBy(p.rawDeductions, (d) => Number(d.amountPerPeriod)) *
            p.paycheck.periodsPerYear
          : 0,
      )
    : 0;
  const contribPeople = contribData?.people ?? [];
  const contribJoint = contribData?.jointAccountTypes ?? [];
  const allAccountTypes = [
    ...contribPeople.flatMap((p) => p.accountTypes),
    ...contribJoint,
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
    contribJoint.filter((a) => isRetirementParent(a.parentCategory)),
    (a) => a.employeeContrib,
  );
  const jointPortfolioNoMatch = sumBy(
    contribJoint.filter((a) => isPortfolioParent(a.parentCategory)),
    (a) => a.employeeContrib,
  );
  // "projected" (not viewMode) — same full-year-always rule as netIncome/
  // grossIncome above.
  const retirementTotal =
    sumBy(
      contribPeople,
      (p) => p.totals.views.projected.retirementWithoutMatch,
    ) + jointRetirementNoMatch;
  const portfolioTotal =
    sumBy(
      contribPeople,
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
  // Extra-paycheck money currently set to go to savings (the Savings/Budget
  // toggle — see extra-paycheck-rules-editor.tsx) isn't part of any goal's
  // steady-state monthlyAllocation rate, so annualSavings above never sees
  // it. Left out, this income shows as spuriously "unallocated" even though
  // it's already spoken for.
  //
  // Computed from the real calendar (which months this year actually have
  // a 3rd paycheck — job-specific, depends on anchorPayDate) times the
  // CURRENT toggle setting, applied uniformly across the whole year — not
  // from which months the materializer happened to already generate a real
  // savings_planned_transactions row for. The two differ for a real reason:
  // the materializer can't retroactively create a transaction for a month
  // that already passed before a routing rule existed to cover it, so an
  // actual-transactions count silently misses genuinely-Savings-mode months
  // early in the year. For "what does this year look like under the
  // current setting" (this card, not a ledger of what's already been
  // physically transferred), the toggle's current answer should apply to
  // every extra-paycheck month this year alike, past or future.
  const yearStart = new Date(Date.UTC(new Date().getFullYear(), 0, 1));
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
      yearStart,
      12,
    ).filter((k) => k.startsWith(String(yearStart.getUTCFullYear())));
    return extraMonthsThisYear.length * netPayPerCheck;
  });
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
    { name: "Unallocated", annual: unallocated, color: "bg-surface-strong" },
  ]
    .map((r) => ({ ...r, pct: safeDivide(r.annual, incomeBase, 0) }))
    // A half-dollar floor, not `> 0` — floating-point subtraction upstream
    // (categoryTotals nets out linked contribution-account items) can leave
    // a sub-cent positive residue that would otherwise render as a
    // confusing "0% ($0.00)" row.
    .filter((r) => r.annual > 0.5);
  // Sanity-check display, not a separate computation: Unallocated is built
  // to absorb whatever's left, so this should always land at (or very near)
  // 100% — the one case it visibly won't is genuine over-allocation (taxes +
  // contributions + savings + budget spending together exceed income),
  // where Unallocated's floor at $0 makes the shown total undercount on
  // purpose rather than display a negative "leftover."
  const totalPct =
    sumBy(rows, (r) => r.pct) + sumBy(extraGrossRows, (r) => r.pct);

  return (
    <Card
      title={
        <>
          Living Costs
          <HelpTip
            text={`Always shows the full-year projected picture, regardless of the Paycheck page's Current Salary/Year-End Estimate/Actual YTD selector — every number here besides income (budget spending, savings, retirement, portfolio, extra-paycheck routing) is this app's annualized RATE for that thing, not a real posted-transaction year-to-date total, so scoping just the income side to "so far this year" would push every percentage well past 100%. Budget categories as % of ${incomeLabel} income compared to Dave Ramsey's recommended ranges (Ramsey's original ranges are based on net take-home pay). Retirement/Portfolio/Savings/Extra Paycheck/Unallocated below show where the rest of your ${incomeLabel} income goes: Net counts only non-payroll contributions (IRA, manually-funded brokerage/HSA) actually funded from take-home pay — payroll-deducted contributions, Roth included, never touch net pay; Gross counts your full contribution total, payroll and non-payroll combined, plus taxes and any other payroll deduction (health/dental/vision insurance, etc.) — those already come out before net pay is computed too, so Gross names them explicitly instead of leaving them invisibly baked into Net. Extra Paycheck is this year's 3rd-biweekly-paycheck months currently set to route to a savings goal (see the Savings/Budget toggle on Salary Profile or the Paycheck page) — computed from the real pay calendar, not from which months have already been transferred. Unallocated includes any budget category with no Ramsey mapping, plus any genuinely untracked money.`}
          />
        </>
      }
      subtitle={`${onTarget}/${rows.length} within range${
        activeBudgetProfileName
          ? ` · ${activeBudgetProfileName}${isBudgetPinned ? " (pinned)" : ""}`
          : ""
      } · full-year view`}
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
        {extraGrossRows.length > 0 && (
          <div className="pt-2 mt-1 border-t border-subtle space-y-2">
            {extraGrossRows.map((r) => (
              <div key={r.name} className="text-xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-muted">{r.name}</span>
                  <span className="text-faint">
                    <span className="font-medium text-primary">
                      {formatPercent(r.pct, 0)}
                    </span>{" "}
                    <span className="text-faint">
                      ({formatCurrency(r.annual)})
                    </span>
                  </span>
                </div>
                <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${r.color}`}
                    style={{ width: `${Math.min(r.pct * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {extraGrossRows.length > 0 && (
        <p className="mt-1 text-right text-micro text-faint">
          Total: {formatPercent(totalPct, 0)} of {incomeLabel}
        </p>
      )}
      <div className="mt-2 flex gap-3 text-caption text-faint">
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
        {extraGrossRows.length > 0 && (
          <span className="flex items-center gap-1 ml-auto">
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
