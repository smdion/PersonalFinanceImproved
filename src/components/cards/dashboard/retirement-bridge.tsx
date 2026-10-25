"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { BRIDGE_SOURCE_LABELS } from "@/lib/config/display-labels";
import { retirementBridge } from "@/lib/pure/retirement-bridge";
import type { EngineYearProjection } from "@/lib/calculators/types/engine-projection";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";

/** Below this age at retirement, the bridge question applies. */
const BRIDGE_RELEVANT_BEFORE_AGE = 60;

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
        <span className="text-muted text-sm">Bridge to penalty-free money</span>
        <p className="text-secondary mt-1 text-xs">
          Nothing locked when retirement starts in {b.year} — no bridge needed.
        </p>
      </div>
    ) : null;

  const shortYears = b.years.filter((y) => y.short);
  const totalNeed = sumBy(b.years, (y) => y.need);
  const causes = new Set(shortYears.map((y) => y.cause));
  const workplace = b.sources.some((s) => s.kind === "workplacePlan");

  return (
    <div>
      <span className="text-muted text-sm">
        Bridge to penalty-free money
        <HelpTip text="Retiring before 59½ means some retirement money is locked — drawing it costs a 10% penalty. These are the years until it opens: spending after Social Security, paid from money you can reach without the penalty. From the projection at your assumed returns; a bad market in these years shrinks the cushion." />
      </span>
      <p className="text-secondary mt-1 text-xs">
        {b.firstYear}–{b.lastYear}: {formatCurrency(totalNeed, 0)} of spending
        after Social Security before locked money opens
      </p>
      <p
        className={`mt-1 text-sm font-medium ${shortYears.length ? "text-red-600" : "text-green-600"}`}
      >
        {shortYears.length
          ? `Short in ${shortYears.map((y) => y.year).join(", ")}`
          : b.cushion
            ? `Covered at assumed returns — tightest in ${b.cushion.year}, ${formatCurrency(b.cushion.amount, 0)} of penalty-free money left`
            : "Covered at assumed returns"}
      </p>
      <div className="mt-1 flex flex-wrap gap-1" aria-label="Bridge years">
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
      {b.sources.length > 0 && (
        <p className="text-muted mt-1 text-xs">
          Penalty-free in {b.firstYear}:{" "}
          {b.sources
            .map(
              (s) =>
                `${BRIDGE_SOURCE_LABELS[s.kind]} ${formatCurrency(s.amount, 0)}`,
            )
            .join(" · ")}
          {b.hsa > 0 &&
            ` · HSA ${formatCurrency(b.hsa, 0)} for medical costs only before 65`}
        </p>
      )}
      {b.unlocks.length > 0 && (
        <p className="text-faint text-xs">
          Locked money opens:{" "}
          {b.unlocks.map((u) => `${u.name} ${u.year}`).join(", ")}
        </p>
      )}
      <ul className="text-faint mt-1 space-y-0.5 text-xs">
        {causes.has("locked") && (
          <li>
            Short because money is locked — retire later, keep a workplace plan
            open under the Rule of 55, or let an account take penalized draws.
          </li>
        )}
        {causes.has("portfolioExcluded") && (
          <li>
            Short while Portfolio savings sit outside the retirement plan —
            count them toward retirement to use them here.
          </li>
        )}
        {causes.has("outOfMoney") && (
          <li>
            Short on money that can be reached — build taxable savings, or start
            Roth conversions at least 5 years before retiring.
          </li>
        )}
        {workplace && (
          <li>
            Counts the workplace plan under the Rule of 55: leave that employer
            in or after the year you turn 55.
          </li>
        )}
        {b.strategyCut > 0 && (
          <li>
            Covered only by cutting {formatCurrency(b.strategyCut, 0)} of
            spending (the withdrawal strategy&apos;s guardrails).
          </li>
        )}
        {b.penaltyCost > 0 && (
          <li>
            Includes {formatCurrency(b.penaltyCost, 0)} of early-withdrawal
            penalties.
          </li>
        )}
        {b.conversionsDuring && (
          <li>
            Roth conversions in these years aren&apos;t counted toward
            penalty-free money yet.
          </li>
        )}
        {b.rothBasisUncertain && (
          <li>
            A Roth basis record is out of date — the Roth amount may be
            understated.
          </li>
        )}
        {b.unownedAccounts.length > 0 && (
          <li>
            No owner set on {b.unownedAccounts.join(", ")} — counted as
            unlocked; set one so its age rules apply.
          </li>
        )}
      </ul>
    </div>
  );
}
