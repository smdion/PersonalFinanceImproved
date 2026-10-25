"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { BRIDGE_SOURCE_LABELS } from "@/lib/config/display-labels";
import {
  retirementBridge,
  type BridgeYear,
  type RetirementBridge as Bridge,
} from "@/lib/pure/retirement-bridge";
import type { EngineYearProjection } from "@/lib/calculators/types/engine-projection";
import { compactCurrency, formatCurrency } from "@/lib/utils/format";

/** Below this age at retirement, the bridge question applies. */
const BRIDGE_RELEVANT_BEFORE_AGE = 60;

const LABEL = "Early-retirement bridge";
const WHAT_IT_IS =
  "Retiring before 59½: some retirement accounts stay locked (10% penalty to draw) until they open.";
const HOW_JUDGED =
  "Covered: each year's spending after Social Security is paid from money you can reach without the penalty, in your retirement projection at fixed assumed returns (no bad markets).";

/** What helps, for the first reason a year fell short. */
const SHORT_FIX: Record<NonNullable<BridgeYear["cause"]>, string> = {
  locked:
    "Money is locked: retire later, keep a workplace plan under the Rule of 55, or allow penalized draws.",
  portfolioExcluded:
    "Portfolio savings sit outside the retirement plan — count them toward retirement to use them here.",
  outOfMoney:
    "Not enough reachable money: build taxable savings, or start Roth conversions 5+ years before retiring.",
};

const list = (items: string[]) => items.join(" · ");

/** The help tip carries the detail; the card stays a quick read. */
function detailLines(b: Extract<Bridge, { status: "bridge" }>): string[] {
  const lines = [WHAT_IT_IS, HOW_JUDGED];
  if (b.sources.length > 0)
    lines.push(
      `Reachable in ${b.firstYear}: ${list(b.sources.map((s) => `${BRIDGE_SOURCE_LABELS[s.kind]} ${compactCurrency(s.amount)}`))}`,
    );
  if (b.hsa > 0)
    lines.push(
      `Not counted: HSA ${compactCurrency(b.hsa)} (medical only before 65)`,
    );
  if (b.unlocks.length > 0)
    lines.push(`Opens: ${list(b.unlocks.map((u) => `${u.name} ${u.year}`))}`);
  const notes = [
    b.sources.some((s) => s.kind === "workplacePlan") &&
      "Rule of 55 needs you to leave that employer in or after the year you turn 55.",
    b.strategyCut > 0 &&
      `Guardrails cut ${compactCurrency(b.strategyCut)} of spending in these years.`,
    b.penaltyCost > 0 &&
      `Includes ${compactCurrency(b.penaltyCost)} of early-withdrawal penalties.`,
    b.conversionsDuring &&
      "Roth conversions in these years aren't counted as reachable yet.",
    b.rothBasisUncertain &&
      "A Roth basis record is out of date — Roth may be understated.",
    b.unownedAccounts.length > 0 &&
      `No owner on ${b.unownedAccounts.join(", ")} — set one so its age rules apply.`,
  ].filter((n): n is string => typeof n === "string");
  return [...lines, ...notes.map((n) => `Note: ${n}`)];
}

/**
 * The bridge to penalty-free money: can the first retirement years be paid
 * for while some retirement money is still locked by early-withdrawal
 * rules? Read from the fixed-return projection (lib/pure/retirement-bridge).
 */
export function RetirementBridge({
  projection,
}: {
  projection: readonly EngineYearProjection[];
}) {
  const b = retirementBridge(projection);
  if (b.status === "unknown") return null;
  if (b.status === "nothingLocked")
    return b.age < BRIDGE_RELEVANT_BEFORE_AGE ? (
      <div>
        <span className="text-muted text-sm">
          {LABEL}
          <HelpTip text={WHAT_IT_IS} />
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-bold text-green-600">Not needed</span>
          <span className="text-muted text-xs">
            nothing locked when retirement starts in {b.year}
          </span>
        </div>
      </div>
    ) : null;

  const shortYears = b.years.filter((y) => y.short);
  const range = `${b.firstYear}${b.lastYear > b.firstYear ? `–${b.lastYear}` : ""}`;
  const firstCause = shortYears.find((y) => y.cause)?.cause;

  return (
    <div>
      <span className="text-muted text-sm">
        {LABEL}
        <HelpTip lines={detailLines(b)} maxWidth={340} />
      </span>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`text-xl font-bold ${shortYears.length ? "text-red-600" : "text-green-600"}`}
        >
          {shortYears.length ? "Short" : "Covered"}
        </span>
        <span className="text-muted text-xs">
          {shortYears.length
            ? `${shortYears.length} of ${b.years.length} yr${b.years.length === 1 ? "" : "s"} · ${range}`
            : `${range} · until locked accounts open`}
        </span>
      </div>
      {shortYears.length > 0 && firstCause ? (
        <p className="text-faint text-xs">{SHORT_FIX[firstCause]}</p>
      ) : (
        b.cushion && (
          <p className="text-faint text-xs">
            Tightest: {b.cushion.year}, {compactCurrency(b.cushion.amount)} to
            spare
          </p>
        )
      )}
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Bridge years">
        {b.years.map((y) => (
          <span
            key={y.year}
            title={`${y.year}: ${formatCurrency(y.covered, 0)} of ${formatCurrency(y.need, 0)} covered${y.ssIncome > 0 ? ` (after ${formatCurrency(y.ssIncome, 0)} Social Security)` : ""}`}
            className={`text-caption rounded px-1.5 py-0.5 ${y.short ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}
          >
            {y.year}
          </span>
        ))}
      </div>
    </div>
  );
}
