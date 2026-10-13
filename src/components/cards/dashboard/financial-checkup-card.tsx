"use client";

import { memo, useState, type ReactNode } from "react";

import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatSavingsRate } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { DEFAULT_HIGH_INCOME_THRESHOLD } from "@/lib/constants";
import { CHECKUP_MILESTONES } from "@/lib/config/milestones";
import { meetsRateTarget, type MilestoneResult } from "@/lib/pure/milestones";
import {
  householdSavings,
  householdTotalCompensation,
  isHighIncomeHousehold,
} from "@/lib/pure/contributions";
import { useScenario } from "@/lib/context/scenario-context";
import {
  useContributionSummaryInput,
  useMilestones,
} from "@/lib/hooks/use-milestones";
import { LoadingCard, ErrorCard } from "./utils";
import { SavingsRateBreakdown } from "./savings-rate-breakdown";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";

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

/** A milestone's status as the Checkup's traffic light. */
function checkupStatus(r: MilestoneResult): CheckupStep["status"] {
  if (r.alert) return "red";
  if (r.status === "reached" || r.status === "onTrack") return "green";
  if (r.status === "behind") return "yellow";
  return "gray";
}

function FinancialCheckupCardImpl() {
  const { viewMode } = useScenario();
  const contribInput = useContributionSummaryInput();
  const [highIncomeThreshold] = usePersistedSetting<number>(
    "high_income_threshold",
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  const [savingsRateThresholds] = usePersistedSetting<string>(
    "savings_rate_thresholds",
    "[0.25, 0.15]",
  );
  const milestones = useMilestones();
  const contribs = trpc.contribution.computeSummary.useQuery(contribInput);

  const contribPeople = contribs.data?.people?.filter((d) => d.result) ?? [];
  const highIncome = isHighIncomeHousehold(
    householdTotalCompensation(contribPeople),
    highIncomeThreshold,
  );
  const { excludeMatch, includePortfolio, toggleMatch, togglePortfolio } =
    useSavingsRateOptions(highIncome);

  if (milestones.isLoading || contribs.isLoading)
    return <LoadingCard title="Financial Checkup" />;
  if (milestones.error || contribs.error)
    return <ErrorCard title="Financial Checkup" message="Failed to load" />;

  const byId = new Map(milestones.results.map((r) => [r.id, r]));
  const milestoneStep = (id: string, label: string): CheckupStep[] => {
    const r = byId.get(id);
    if (!r) return [];
    // The FI row's pace comes from the projection — wait for it rather than
    // flash "unknown" first.
    if (id === "fi" && milestones.projectionLoading && r.status !== "reached")
      return [
        { label, helpTip: r.rule, status: "gray", text: "…", href: r.href },
      ];
    return [
      {
        label,
        helpTip: r.rule,
        status: checkupStatus(r),
        text: r.short,
        subText: r.note ?? undefined,
        href: r.href,
      },
    ];
  };
  const [efundRow, matchRow, debtRow, ...laterRows] = CHECKUP_MILESTONES.map(
    (m) => milestoneStep(m.id, m.label),
  );
  const steps: CheckupStep[] = [
    ...(efundRow ?? []),
    ...(matchRow ?? []),
    ...(debtRow ?? []),
  ];

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
    status: meetsRateTarget(savingsRate, greenThreshold)
      ? "green"
      : meetsRateTarget(savingsRate, yellowThreshold)
        ? "yellow"
        : "red",
    text: formatSavingsRate(savingsRate),
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

  steps.push(...laterRows.flat());

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
      headerRight={
        <a
          href="/milestones"
          className="text-caption text-blue-600 hover:underline"
        >
          Milestones →
        </a>
      }
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
