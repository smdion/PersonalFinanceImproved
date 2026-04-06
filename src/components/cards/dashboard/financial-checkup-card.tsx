"use client";

import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import {
  FI_COMPLETE_THRESHOLD,
  FI_ON_TRACK_THRESHOLD,
  DEFAULT_HIGH_INCOME_THRESHOLD,
} from "@/lib/constants";
import { wealthScoreTier } from "@/lib/config/display-labels";
import { LoadingCard, ErrorCard } from "./utils";

type CheckupStep = {
  label: string;
  helpTip?: string;
  status: "green" | "yellow" | "red" | "gray";
  text: string;
  href: string;
};

function CheckupIcon({ status }: { status: CheckupStep["status"] }) {
  if (status === "green")
    return (
      <svg
        className="w-4 h-4 text-green-500 flex-shrink-0"
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
        className="w-4 h-4 text-amber-500 flex-shrink-0"
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
        className="w-4 h-4 text-red-500 flex-shrink-0"
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
      className="w-4 h-4 text-faint flex-shrink-0"
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
  const badgeColor = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    gray: "bg-surface-elevated text-muted",
  }[step.status];

  return (
    <a
      href={step.href}
      className="flex items-center gap-2 py-1.5 group hover:bg-surface-sunken -mx-1 px-1 rounded transition-colors"
    >
      <CheckupIcon status={step.status} />
      <span className="text-sm text-secondary flex-1 group-hover:text-primary">
        {step.label}
        {step.helpTip && <HelpTip text={step.helpTip} />}
      </span>
      <span
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${badgeColor}`}
      >
        {step.text}
      </span>
    </a>
  );
}

export function FinancialCheckupCard() {
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
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
  const savings = trpc.savings.computeSummary.useQuery(efundTierInput);
  const contribs = trpc.contribution.computeSummary.useQuery(contribInput);
  const mortgage = trpc.mortgage.computeActiveSummary.useQuery();
  const networth = trpc.networth.computeSummary.useQuery();

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
    steps.push({
      label: "Debt Payoff",
      status: primary.monthsAheadOfSchedule > 0 ? "green" : "yellow",
      text:
        primary.monthsAheadOfSchedule > 0
          ? `${primary.monthsAheadOfSchedule} mo ahead`
          : `${Math.ceil(primary.remainingMonths / 12)} yr remaining`,
      href: "/mortgage",
    });
  }

  // 4. Savings Rate
  const contribPeople = contribs.data?.people?.filter((d) => d.result) ?? [];
  // Use totalCompensation (always includes bonus) — shared logic with contributions page
  const householdTotalComp = contribPeople.reduce(
    (s, d) => s + (d.totalCompensation ?? d.salary ?? 0),
    0,
  );
  const highIncome = householdTotalComp >= highIncomeThreshold;
  // Use server-computed savings rates (single source of truth)
  const rateKey = highIncome
    ? "savingsRateWithoutMatch"
    : "savingsRateWithMatch";
  const savingsRate =
    householdTotalComp > 0
      ? contribPeople.reduce(
          (s, d) =>
            s +
            (d.totals?.[rateKey as keyof typeof d.totals] ?? 0) *
              (d.totalCompensation ?? d.salary ?? 0),
          0,
        ) / householdTotalComp
      : 0;
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
    href: "/paycheck",
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
  const fiPortfolio = networth.data?.portfolioTotal ?? 0;
  if (fiTarget > 0) {
    steps.push({
      label: "FI Progress",
      helpTip:
        "Financial Independence target: annual expenses / withdrawal rate (set in Retirement settings). Portfolio value vs. FI number.",
      status:
        fiProgress >= FI_COMPLETE_THRESHOLD
          ? "green"
          : fiProgress >= FI_ON_TRACK_THRESHOLD
            ? "yellow"
            : "red",
      text: `${formatPercent(fiProgress, 1)} — ${formatCurrency(fiPortfolio)} / ${formatCurrency(fiTarget)}`,
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
