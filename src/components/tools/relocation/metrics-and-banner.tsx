"use client";

/** Key metrics cards + recommendation banner + warnings for the Relocation
 *  calculator. Extracted from tools/page.tsx during the v0.5.2 file-split
 *  refactor. Stateless — reads only from the `result` and `engineResult` props.
 */

import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { RelocationEngineResult, RelocationResult } from "./types";

type Props = {
  result: RelocationResult;
  /** Engine-backed retirement projection result.
   *  undefined = still loading; null = error or no retirement settings. */
  engineResult?: RelocationEngineResult | null;
  moveYear: number | null;
};

export function RelocationMetricsAndBanner({
  result: r,
  engineResult,
  moveYear,
}: Props) {
  // Use engine's relocationFiTarget when loaded so the "Additional Nest Egg"
  // value is consistent with the subtitle arrows (same target in both places).
  const relocFiTarget =
    engineResult?.relocationFiTarget ?? r.relocationFiTarget;
  const additionalNestEggNeeded = relocFiTarget - r.currentFiTarget;

  const hasBlended = moveYear !== null && engineResult?.blendedRows != null;

  return (
    <>
      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Monthly Delta
            <HelpTip text="How much more (or less) you'd spend each month after relocating" />
          </div>
          <div
            className={`text-lg font-bold ${r.monthlyExpenseDelta > 0 ? "text-red-600" : r.monthlyExpenseDelta < 0 ? "text-green-600" : ""}`}
          >
            {r.monthlyExpenseDelta > 0 ? "+" : ""}
            {formatCurrency(r.monthlyExpenseDelta)}
          </div>
          <div className="text-xs text-faint">
            {r.percentExpenseIncrease > 0 ? "+" : ""}
            {r.percentExpenseIncrease}%{" "}
            {r.percentExpenseIncrease > 0
              ? "increase"
              : r.percentExpenseIncrease < 0
                ? "decrease"
                : ""}
          </div>
        </div>

        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Additional Nest Egg Needed
            <HelpTip text="Extra savings required to maintain the same retirement readiness with higher expenses" />
          </div>
          <div
            className={`text-lg font-bold ${additionalNestEggNeeded > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {additionalNestEggNeeded > 0 ? "+" : ""}
            {formatCurrency(additionalNestEggNeeded)}
          </div>
          <div className="text-xs text-faint">
            Target: {formatCurrency(r.currentFiTarget)} →{" "}
            {formatCurrency(relocFiTarget)}
          </div>
        </div>

        <div className="bg-surface-sunken rounded-lg p-3">
          <div className="text-xs text-muted uppercase">
            Savings Rate Impact
            <HelpTip text="How much your monthly savings rate would change after relocating" />
          </div>
          <div
            className={`text-lg font-bold ${r.savingsRateDrop > 0 ? "text-red-600" : "text-green-600"}`}
          >
            {r.savingsRateDrop > 0 ? "−" : "+"}
            {formatPercent(Math.abs(r.savingsRateDrop))}
          </div>
          <div className="text-xs text-faint">
            {formatPercent(r.currentSavingsRate)} →{" "}
            {formatPercent(r.relocationSavingsRate)}
          </div>
        </div>

        {/* Fourth card: blended balance impact when moveYear is set, otherwise portfolio at retirement */}
        {hasBlended ? (
          <div className="bg-surface-sunken rounded-lg p-3">
            <div className="text-xs text-muted uppercase">
              Balance at Retirement (Move {moveYear})
              <HelpTip text="Projected portfolio balance at your configured retirement age on the blended path: current budget until the move year, then relocation budget." />
            </div>
            {engineResult === undefined ? (
              <div className="h-7 w-24 bg-surface-elevated rounded animate-pulse mt-1" />
            ) : engineResult === null ? (
              <div className="text-lg font-bold text-muted">—</div>
            ) : (
              <>
                <div
                  className={`text-lg font-bold ${
                    (engineResult.blendedBalanceAtRetirement ?? 0) <
                    engineResult.currentBalanceAtRetirement
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  {(engineResult.blendedBalanceAtRetirement ?? 0) >=
                  engineResult.currentBalanceAtRetirement
                    ? "+"
                    : ""}
                  {formatCurrency(
                    (engineResult.blendedBalanceAtRetirement ?? 0) -
                      engineResult.currentBalanceAtRetirement,
                  )}
                </div>
                <div className="text-xs text-faint">
                  {formatCurrency(engineResult.currentBalanceAtRetirement)} →{" "}
                  {formatCurrency(engineResult.blendedBalanceAtRetirement ?? 0)}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bg-surface-sunken rounded-lg p-3">
            <div className="text-xs text-muted uppercase">
              Portfolio at Retirement
              <HelpTip text="Projected portfolio balance at your configured retirement age under each budget scenario" />
            </div>
            {engineResult === undefined ? (
              <div className="h-7 w-24 bg-surface-elevated rounded animate-pulse mt-1" />
            ) : engineResult === null ? (
              <div className="text-lg font-bold text-muted">—</div>
            ) : (
              <>
                <div
                  className={`text-lg font-bold ${engineResult.relocationBalanceAtRetirement < engineResult.currentBalanceAtRetirement ? "text-red-600" : "text-green-600"}`}
                >
                  {engineResult.relocationBalanceAtRetirement >=
                  engineResult.currentBalanceAtRetirement
                    ? "+"
                    : ""}
                  {formatCurrency(
                    engineResult.relocationBalanceAtRetirement -
                      engineResult.currentBalanceAtRetirement,
                  )}
                </div>
                <div className="text-xs text-faint">
                  {formatCurrency(engineResult.currentBalanceAtRetirement)} →{" "}
                  {formatCurrency(engineResult.relocationBalanceAtRetirement)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Primary banner — shows blended path result when moveYear is set */}
      {hasBlended ? (
        <BlendedBanner
          result={r}
          engineResult={engineResult!}
          moveYear={moveYear!}
        />
      ) : (
        <RecommendationBanner result={r} engineResult={engineResult} />
      )}

      {/* Secondary hint — earliest viable year when moveYear is set */}
      {hasBlended && engineResult != null && (
        <EarliestViableHint engineResult={engineResult} />
      )}

      {/* Warnings from calculator */}
      {r.warnings.length > 0 && (
        <div className="space-y-1">
          {r.warnings.map((w) => (
            <div
              key={w}
              className="text-xs text-amber-600 bg-amber-50 rounded p-2"
            >
              {w}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Blended path banner (moveYear set)
// ---------------------------------------------------------------------------

function BlendedBanner({
  result: r,
  engineResult,
  moveYear,
}: {
  result: RelocationResult;
  engineResult: RelocationEngineResult;
  moveYear: number;
}) {
  const blendedBalance = engineResult.blendedBalanceAtRetirement ?? 0;
  const isViable = blendedBalance > 0;

  if (isViable) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-green-800">
          Move in {moveYear} works:
        </span>{" "}
        <span className="text-green-700">
          Switching to the relocation budget in {moveYear} leaves you with{" "}
          <strong>{formatCurrency(blendedBalance)}</strong> at age{" "}
          {r.retirementAge} — your portfolio sustains retirement on the
          relocation budget.
        </span>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
      <span className="font-semibold text-amber-800">
        Move in {moveYear} falls short:
      </span>{" "}
      <span className="text-amber-700">
        Switching to the relocation budget in {moveYear} does not sustain
        retirement by age {r.retirementAge}.
        {engineResult.earliestRelocateYear != null &&
        engineResult.earliestRelocateYear > moveYear
          ? ` The earliest viable move year is ${engineResult.earliestRelocateYear} (age ${engineResult.earliestRelocateAge}).`
          : " Consider reducing relocation expenses or increasing contributions."}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Original recommendation banner (no moveYear)
// ---------------------------------------------------------------------------

function RecommendationBanner({
  result: r,
  engineResult,
}: {
  result: RelocationResult;
  engineResult?: RelocationEngineResult | null;
}) {
  if (engineResult === undefined) {
    return (
      <div className="bg-surface-sunken border border-subtle rounded-lg p-3 h-12 animate-pulse" />
    );
  }
  if (engineResult === null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-amber-800">Note:</span>{" "}
        <span className="text-amber-700">
          Retirement settings are required to project portfolio outcomes.
          Configure your retirement age and settings to see the full analysis.
        </span>
      </div>
    );
  }
  if (engineResult.isViableNow) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-green-800">Ready to relocate:</span>{" "}
        <span className="text-green-700">
          With your current portfolio of{" "}
          <strong>
            {formatCurrency(engineResult.recommendedPortfolioToRelocate)}
          </strong>{" "}
          and the relocation budget, you are projected to retire comfortably at
          age {r.retirementAge}.
        </span>
      </div>
    );
  }
  if (engineResult.earliestRelocateAge !== null) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-blue-800">Recommendation:</span>{" "}
        <span className="text-blue-700">
          Save until age <strong>{engineResult.earliestRelocateAge}</strong>{" "}
          (around {engineResult.earliestRelocateYear}) — at that point your
          portfolio of{" "}
          <strong>
            {formatCurrency(engineResult.recommendedPortfolioToRelocate)}
          </strong>{" "}
          can sustain retirement at age {r.retirementAge} on the relocation
          budget.
        </span>
      </div>
    );
  }
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
      <span className="font-semibold text-amber-800">Warning:</span>{" "}
      <span className="text-amber-700">
        With the relocation budget, the portfolio may not sustain retirement by
        age {r.retirementAge}. Consider reducing expenses, increasing
        contributions, or adjusting your timeline.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earliest viable hint (secondary, shown below blended banner)
// ---------------------------------------------------------------------------

function EarliestViableHint({
  engineResult,
}: {
  engineResult: RelocationEngineResult;
}) {
  if (engineResult.earliestRelocateYear === null) return null;
  return (
    <div className="text-xs text-faint">
      Earliest viable move year:{" "}
      <span className="font-medium text-secondary">
        {engineResult.earliestRelocateYear} (age{" "}
        {engineResult.earliestRelocateAge})
      </span>{" "}
      — portfolio of{" "}
      {formatCurrency(engineResult.recommendedPortfolioToRelocate)} sustains
      retirement on the relocation budget.
    </div>
  );
}
