"use client";

/**
 * Lifetime-tax comparison of withdrawal presets (Traditional first, Brokerage first, Bracket
 * Filling via `WITHDRAWAL_ROUTING_MODE_LABELS`) plus the server's "Your current settings" row;
 * a preset that is the same run as the current plan is annotated (`matchesCurrentPlan`).
 */
import { NotConfiguredNotice } from "@/components/ui/not-configured-notice";
import type { RouterInputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import {
  getDefaultDecumulationOrder,
  isOverflowTarget,
} from "@/lib/config/account-types";
import { WITHDRAWAL_ROUTING_MODE_LABELS } from "@/lib/config/withdrawal-routing";

type Selection = Partial<
  Pick<RouterInputs["projection"]["compareWithdrawalStrategies"], "selection">
>;

// Orders are read from config when called. The default decumulation order
// is already pre-tax-first ("traditional first"); "brokerage first" hoists
// the overflow/taxable bucket to the front.
function presetStrategies(): RouterInputs["projection"]["compareWithdrawalStrategies"]["strategies"] {
  const tradFirst = getDefaultDecumulationOrder();
  const brokerageFirst = [
    ...tradFirst.filter((c) => isOverflowTarget(c)),
    ...tradFirst.filter((c) => !isOverflowTarget(c)),
  ];
  return [
    { label: "Traditional first", mode: "waterfall", order: tradFirst },
    { label: "Brokerage first", mode: "waterfall", order: brokerageFirst },
    {
      label: WITHDRAWAL_ROUTING_MODE_LABELS.bracket_filling,
      mode: "bracket_filling",
    },
  ];
}

/** A preset row and "Your current settings" are the same run when config (mode, waterfall order)
 *  AND output (lifetime tax within a cent, depletion year) match; a config match with different
 *  numbers is a bug to surface, not annotate. */
function ordersMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export function WithdrawalComparison({ selection }: { selection: Selection }) {
  const strategies = presetStrategies();
  const comparison = trpc.projection.compareWithdrawalStrategies.useQuery(
    { ...selection, strategies },
    { placeholderData: (prev) => prev },
  );
  const { data } = comparison;

  if (queryPending(comparison))
    return (
      <QueryBoundary
        query={comparison}
        fallback={<Skeleton className="h-40 w-full" />}
      />
    );
  if (data && "notConfigured" in data)
    return <NotConfiguredNotice reason={data.notConfigured} />;
  if (!data || data.strategies.length === 0) {
    return (
      <p className="text-muted text-xs">
        No projection available for a comparison yet.
      </p>
    );
  }

  const best = data.baselineLabel;
  const currentPlan = data.strategies.find(
    (s) => "isCurrentPlan" in s && s.isCurrentPlan,
  );
  const matchesCurrentPlan = (s: (typeof data.strategies)[number]) => {
    if (!currentPlan || "isCurrentPlan" in s) return false;
    if (s.mode !== currentPlan.mode) return false;
    if (s.mode === "waterfall") {
      const preset = strategies.find((p) => p.label === s.label);
      if (
        !preset?.order ||
        !("withdrawalOrder" in currentPlan) ||
        !ordersMatch(preset.order, currentPlan.withdrawalOrder)
      ) {
        return false;
      }
    }
    return (
      Math.abs(s.lifetimeTax - currentPlan.lifetimeTax) < 1 &&
      s.failureYear === currentPlan.failureYear
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-muted text-xs">
        Lifetime tax = federal + NIIT + IRMAA + Roth-conversion tax, summed over
        the whole decumulation horizon. Lowest wins.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-xs tabular-nums">
          <thead>
            <tr className="border-strong text-muted border-b-2 text-[11px]">
              <th className="px-2 py-2 text-left">Strategy</th>
              <th className="px-2 py-2">Lifetime tax</th>
              <th className="px-2 py-2">Ending pre-tax</th>
              <th className="px-2 py-2">Ending Roth</th>
              <th className="px-2 py-2">Ending taxable</th>
              <th className="px-2 py-2">Falls short?</th>
            </tr>
          </thead>
          <tbody>
            {data.strategies.map((s) => (
              <tr
                key={s.label}
                className={
                  s.label === best
                    ? "bg-green-50 font-medium"
                    : "isCurrentPlan" in s
                      ? "bg-slate-50"
                      : undefined
                }
              >
                <td className="px-2 py-1.5 text-left">
                  {s.label}
                  {"isCurrentPlan" in s && (
                    <span className="ml-1 text-[10px] text-slate-600">
                      your settings
                    </span>
                  )}
                  {matchesCurrentPlan(s) && (
                    <span className="text-faint ml-1 text-[10px]">
                      (same as your current settings)
                    </span>
                  )}
                  {s.label === best && (
                    <span className="ml-1 text-[10px] text-green-700">
                      lowest
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">{formatCurrency(s.lifetimeTax)}</td>
                <td className="text-muted px-2 py-1.5">
                  {s.terminalByTaxType
                    ? formatCurrency(s.terminalByTaxType.preTax)
                    : "—"}
                </td>
                <td className="text-muted px-2 py-1.5">
                  {s.terminalByTaxType
                    ? formatCurrency(s.terminalByTaxType.taxFree)
                    : "—"}
                </td>
                <td className="text-muted px-2 py-1.5">
                  {s.terminalByTaxType
                    ? formatCurrency(s.terminalByTaxType.afterTax)
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {s.failureYear ? (
                    <span className="text-red-700">yes — {s.failureYear}</span>
                  ) : (
                    <span className="text-faint">no</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
