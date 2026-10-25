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
  "Retiring before 59½ leaves some retirement accounts locked — drawing them costs a 10% penalty. These are the years until they open, paid from money you can reach without it (taxable savings, Roth contributions and seasoned conversions, a workplace plan under the Rule of 55). At your assumed returns.";

/** What helps, for the first reason a year fell short. */
const SHORT_FIX: Record<NonNullable<BridgeYear["cause"]>, string> = {
  locked:
    "Money is locked: retire later, keep a workplace plan under the Rule of 55, or allow penalized draws.",
  portfolioExcluded:
    "Portfolio savings sit outside the retirement plan — count them toward retirement to use them here.",
  outOfMoney:
    "Not enough reachable money: build taxable savings, or start Roth conversions 5+ years before retiring.",
};

/** The help tip carries the detail; the card stays a quick read. */
function detailLines(b: Extract<Bridge, { status: "bridge" }>): string[] {
  const lines = [WHAT_IT_IS];
  if (b.sources.length > 0)
    lines.push(
      `Reachable in ${b.firstYear}: ${b.sources
        .map(
          (s) => `${BRIDGE_SOURCE_LABELS[s.kind]} ${compactCurrency(s.amount)}`,
        )
        .join(", ")}.`,
    );
  if (b.hsa > 0)
    lines.push(
      `HSA ${compactCurrency(b.hsa)} not counted — penalty-free only for medical costs before 65.`,
    );
  if (b.unlocks.length > 0)
    lines.push(
      `Locked accounts open: ${b.unlocks.map((u) => `${u.name} ${u.year}`).join(", ")}.`,
    );
  if (b.sources.some((s) => s.kind === "workplacePlan"))
    lines.push(
      "Rule of 55 counts only if you leave that employer in or after the year you turn 55.",
    );
  if (b.strategyCut > 0)
    lines.push(
      `Includes ${formatCurrency(b.strategyCut, 0)} of spending cut by the withdrawal strategy's guardrails.`,
    );
  if (b.penaltyCost > 0)
    lines.push(
      `Includes ${formatCurrency(b.penaltyCost, 0)} of early-withdrawal penalties.`,
    );
  if (b.conversionsDuring)
    lines.push(
      "Roth conversions in these years aren't counted as reachable yet.",
    );
  if (b.rothBasisUncertain)
    lines.push(
      "A Roth basis record is out of date — the Roth amount may be understated.",
    );
  if (b.unownedAccounts.length > 0)
    lines.push(
      `No owner on ${b.unownedAccounts.join(", ")} — counted as open; set one so its age rules apply.`,
    );
  return lines;
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
  const span = `${b.years.length} yr${b.years.length === 1 ? "" : "s"} until locked accounts open (${b.firstYear}${b.lastYear > b.firstYear ? `–${b.lastYear}` : ""})`;
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
          {shortYears.length ? `${shortYears.length} of ${span}` : span}
        </span>
      </div>
      {shortYears.length > 0 && firstCause ? (
        <p className="text-faint text-xs">{SHORT_FIX[firstCause]}</p>
      ) : (
        b.cushion && (
          <p className="text-faint text-xs">
            Tightest: {compactCurrency(b.cushion.amount)} reachable left in{" "}
            {b.cushion.year}
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
