"use client";

import { memo, useState, type ReactNode } from "react";

import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { useFICache } from "@/lib/hooks/use-fi-cache";
import {
  FI_COMPLETE_THRESHOLD,
  DEFAULT_HIGH_INCOME_THRESHOLD,
} from "@/lib/constants";
import { wealthScoreTier } from "@/lib/config/display-labels";
import {
  householdSavings,
  householdTotalCompensation,
  isHighIncomeHousehold,
} from "@/lib/pure/contributions";
import { useScenario } from "@/lib/context/scenario-context";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { LoadingCard, ErrorCard } from "./utils";
import { SavingsRateBreakdown } from "./savings-rate-breakdown";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { formatMonths } from "./mortgage-payoff";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";

type CheckupStep = {
  label: string;
  helpTip?: string;
  status: "green" | "yellow" | "red" | "gray";
  text: string;
  subText?: string;
  href: string;
  /** Shown under the row when it's expanded (the row then toggles instead of linking). */
  detail?: ReactNode;
};

function CheckupIcon({ status }: { status: CheckupStep["status"] }) {
  if (status === "green")
    return (
      <svg
        className="h-4 w-4 flex-shrink-0 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  if (status === "yellow")
    return (
      <svg
        className="h-4 w-4 flex-shrink-0 text-amber-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z"
        />
      </svg>
    );
  if (status === "red")
    return (
      <svg
        className="h-4 w-4 flex-shrink-0 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    );
  return (
    <svg
      className="text-faint h-4 w-4 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function CheckupRow({ step }: { step: CheckupStep }) {
  const [open, setOpen] = useState(false);
  const badgeColor = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    gray: "bg-surface-elevated text-muted",
  }[step.status];

  const rowClass =
    "group hover:bg-surface-sunken -mx-1 flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition-colors";
  const label = (
    <span className="text-secondary group-hover:text-primary flex-1 text-sm">
      {step.label}
      {step.helpTip && <HelpTip text={step.helpTip} />}
      {step.detail && (
        <span className="text-faint ml-1 text-xs" aria-hidden="true">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      )}
    </span>
  );
  const body = (
    <>
      <CheckupIcon status={step.status} />
      {label}
      <div className="text-right">
        <span
          className={`text-caption rounded-full px-1.5 py-0.5 font-medium whitespace-nowrap ${badgeColor}`}
        >
          {step.text}
        </span>
        {step.subText && (
          <div className="text-micro text-faint mt-0.5">{step.subText}</div>
        )}
      </div>
    </>
  );
  if (!step.detail)
    return (
      <a href={step.href} className={rowClass}>
        {body}
      </a>
    );
  return (
    <div>
      <button
        type="button"
        className={rowClass}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {body}
      </button>
      {open && step.detail}
    </div>
  );
}

function FinancialCheckupCardImpl() {
  const { viewMode } = useScenario();
  const salaryActiveFields = useActiveSalaries();
  // Independent Salary Profile axis (Plan pin -> globally-active setting).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const { queryInput: contribProfileInput } = useEffectiveContribProfileId();
  const contribInput = {
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...contribProfileInput,
    ...salaryProfileInput,
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];
  const [efundBudgetColumn] = usePersistedSetting<number>(
    "efund_budget_column",
    -1,
  );
  const [highIncomeThreshold] = usePersistedSetting<number>(
    "high_income_threshold",
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  const [savingsRateThresholds] = usePersistedSetting<string>(
    "savings_rate_thresholds",
    "[0.25, 0.15]",
  );
  const efundTierInput =
    efundBudgetColumn >= 0
      ? { budgetTierOverride: efundBudgetColumn }
      : undefined;
  const [fiCache] = useFICache();
  const savings = trpc.savings.computeSummary.useQuery(efundTierInput);
  const contribs = trpc.contribution.computeSummary.useQuery(contribInput);
  const mortgage = trpc.mortgage.computeActiveSummary.useQuery();
  const yearEndTargeting = useYearEndTargetingInput();
  const networth = trpc.networth.computeSummary.useQuery(yearEndTargeting);

  const contribPeople = contribs.data?.people?.filter((d) => d.result) ?? [];
  const highIncome = isHighIncomeHousehold(
    householdTotalCompensation(contribPeople),
    highIncomeThreshold,
  );
  const { excludeMatch, includePortfolio, toggleMatch, togglePortfolio } =
    useSavingsRateOptions(highIncome);

  const isLoading =
    savings.isLoading ||
    contribs.isLoading ||
    mortgage.isLoading ||
    networth.isLoading;
  const hasError =
    savings.error || contribs.error || mortgage.error || networth.error;

  if (isLoading) return <LoadingCard title="Financial Checkup" />;
  if (hasError)
    return <ErrorCard title="Financial Checkup" message="Failed to load" />;

  const steps: CheckupStep[] = [];

  // 1. Emergency Fund
  const efund = savings.data?.efund;
  if (efund && efund.monthsCovered !== null) {
    const months = efund.monthsCoveredWithRepay ?? efund.monthsCovered;
    steps.push({
      label: "Emergency Fund",
      helpTip:
        "Months of essential expenses covered by liquid savings. Target is 3-6 months.",
      status: months >= 3 ? "green" : months >= 1 ? "yellow" : "red",
      text: `${months.toFixed(1)} mo covered`,
      href: "/savings",
    });
  }

  // 2. Employer Match
  const people =
    contribs.data?.people?.filter((d) => d.accountTypes.length > 0) ?? [];
  const totalMatch = people.reduce(
    (s, p) => s + p.accountTypes.reduce((ls, a) => ls + a.employerMatch, 0),
    0,
  );
  if (totalMatch > 0) {
    steps.push({
      label: "Employer Match",
      status: "green",
      text: `${formatCurrency(totalMatch)}/yr captured`,
      href: "/paycheck",
    });
  } else if (people.length > 0) {
    steps.push({
      label: "Employer Match",
      status: "gray",
      text: "No match data",
      href: "/paycheck",
    });
  }

  // 3. Debt Payoff (Mortgage)
  const activeLoans =
    mortgage.data?.result.loans.filter((l) => l.remainingMonths > 0) ?? [];
  if (activeLoans.length === 0) {
    steps.push({
      label: "Debt Payoff",
      status: "green",
      text: "Mortgage paid off",
      href: "/mortgage",
    });
  } else {
    const primary = activeLoans[0]!;
    // Ahead of the original loan (refinancing + extra payments) — the same
    // figure Net Worth's payoff line shows.
    const monthsAhead = mortgage.data?.result.totalMonthsSaved ?? 0;
    steps.push({
      label: "Debt Payoff",
      status: monthsAhead > 0 ? "green" : "yellow",
      text:
        monthsAhead > 0
          ? `${formatMonths(monthsAhead)} ahead`
          : `${Math.ceil(primary.remainingMonths / 12)} yr remaining`,
      href: "/mortgage",
    });
  }

  // 4. Savings Rate — expands into what it's made of.
  const savingsBreakdown = householdSavings(
    contribPeople,
    contribs.data?.jointAccountTypes ?? [],
    viewMode,
    { excludeMatch, includePortfolio },
  );
  const savingsRate = savingsBreakdown.rate;
  const parsedThresholds = (() => {
    try {
      const arr = JSON.parse(
        typeof savingsRateThresholds === "string"
          ? savingsRateThresholds
          : JSON.stringify(savingsRateThresholds),
      );
      return Array.isArray(arr) && arr.length >= 2
        ? (arr as number[])
        : [0.25, 0.15];
    } catch {
      return [0.25, 0.15];
    }
  })();
  const greenThreshold = parsedThresholds[0] ?? 0.25;
  const yellowThreshold = parsedThresholds[1] ?? 0.15;

  steps.push({
    label: "Savings Rate",
    status:
      savingsRate >= greenThreshold
        ? "green"
        : savingsRate >= yellowThreshold
          ? "yellow"
          : "red",
    text: formatPercent(savingsRate, 1),
    subText:
      [
        excludeMatch ? null : "incl. match",
        includePortfolio ? null : "retirement only",
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    href: "/paycheck",
    detail: (
      <SavingsRateBreakdown
        savings={savingsBreakdown}
        viewMode={viewMode}
        excludeMatch={excludeMatch}
        onToggleMatch={toggleMatch}
        includePortfolio={includePortfolio}
        onTogglePortfolio={togglePortfolio}
        highIncome={highIncome}
        highIncomeThreshold={highIncomeThreshold}
        targets={{ good: yellowThreshold, great: greenThreshold }}
      />
    ),
  });

  // 5. Wealth Score (uses AAW score — Money Guy formula — for PAW/AAW/UAW tier)
  const aawScore = networth.data?.result.aawScoreMarket ?? 0;
  const wealthTier = wealthScoreTier(aawScore);
  steps.push({
    label: "Wealth Score",
    helpTip:
      "Money Guy Wealth Accumulator. PAW (2x+) = Prodigious, AAW (1x) = Average, UAW (<0.5x) = Under Accumulator.",
    status: wealthTier.tier === "uaw" ? "red" : "green",
    text: wealthTier.shortLabel,
    href: "/networth",
  });

  // 6. FI Progress
  const fiProgress = networth.data?.result.fiProgress ?? 0;
  const fiTarget = networth.data?.result.fiTarget ?? 0;
  const currentYear = new Date().getFullYear();
  if (fiTarget > 0) {
    let fiStatus: CheckupStep["status"];
    let fiText: string;
    let fiSubText: string | undefined;

    const fiAchieved =
      fiProgress >= FI_COMPLETE_THRESHOLD ||
      (fiCache !== null &&
        fiCache.fiYear !== null &&
        fiCache.fiYear <= currentYear);

    if (fiAchieved) {
      fiStatus = "green";
      fiText = "FI Achieved!";
    } else if (fiCache === null) {
      fiStatus = "gray";
      fiText = "Run retirement projection";
    } else if (fiCache.fiYear === null) {
      fiStatus = "red";
      fiText = "FI target unreachable";
    } else {
      fiStatus = "yellow";
      fiText =
        fiCache.fiAge !== null
          ? `On pace for age ${fiCache.fiAge}`
          : "On pace for FI";
      fiSubText = `${fiCache.fiYear} · based on retirement plan`;
    }

    steps.push({
      label: "FI Progress",
      helpTip:
        "Financial Independence target: annual expenses / withdrawal rate (set in Retirement settings). Portfolio value vs. FI number.",
      status: fiStatus,
      text: fiText,
      subText: fiSubText,
      href: "/networth",
    });
  }

  const greenCount = steps.filter((s) => s.status === "green").length;

  return (
    <Card
      title={
        <>
          Financial Checkup
          <HelpTip text="Key financial health indicators. Green means on track, yellow needs attention, red needs action." />
        </>
      }
      subtitle={`${greenCount}/${steps.length} on track`}
    >
      <div className="divide-y">
        {steps.map((step) => (
          <CheckupRow key={step.label} step={step} />
        ))}
      </div>
    </Card>
  );
}

export const FinancialCheckupCard = memo(FinancialCheckupCardImpl);
