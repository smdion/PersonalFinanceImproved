"use client";

/**
 * Side-by-side lifetime-tax comparison of withdrawal-sequencing
 * strategies (roadmap #2). Runs `compareWithdrawalStrategies` with three
 * fixed presets that are cleanly expressible through `withdrawalRoutingMode`
 * + `withdrawalOrder`:
 *  - Traditional first → waterfall, pre-tax categories drained first
 *  - Brokerage first   → waterfall, taxable drained first
 *  - Bracket Filling   → bracket_filling (the engine's dynamic mode) —
 *    labeled from the SAME `WITHDRAWAL_ROUTING_MODE_LABELS` map the
 *    Retirement page's Withdrawal Routing panel and the Taxes-in-Retirement
 *    profile section use. This used to be hardcoded here as "Tax-optimized"
 *    — a name that appeared nowhere else, so a household that saw it win
 *    had no way to find or set it on their profile.
 * ("Roth first" is deliberately omitted — it needs a tax-preference
 * override, not a category order, which this procedure doesn't take.)
 *
 * The server also returns a 4th row, "Your current plan" (`isCurrentPlan`)
 * — the household's REAL resolved routing mode (session override, else the
 * persisted profile default), scored the identical way. It can coincide
 * with one of the three presets or differ from all of them (e.g. a
 * household on a custom waterfall order); either way it's the household's
 * actual plan, not a guess matched by mode string. When it DOES coincide
 * with a preset (the common case — most households are on Bracket
 * Filling), the two rows would otherwise show identical numbers with no
 * acknowledgment they're the same thing; `matchesCurrentPlan` annotates
 * the preset row instead of leaving that silently redundant.
 */
import type { RouterInputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDefaultDecumulationOrder,
  isOverflowTarget,
} from "@/lib/config/account-types";
import { WITHDRAWAL_ROUTING_MODE_LABELS } from "@/lib/config/withdrawal-routing";

type Selection = Partial<
  Pick<
    RouterInputs["projection"]["compareWithdrawalStrategies"],
    "retirementProfileId"
  >
>;

// Orders are derived from config, never hardcoded (RULES.md). The default
// decumulation order is already pre-tax-first ("traditional first");
// "brokerage first" hoists the overflow/taxable bucket to the front.
const TRAD_FIRST_ORDER = getDefaultDecumulationOrder();
const BROKERAGE_FIRST_ORDER = [
  ...TRAD_FIRST_ORDER.filter((c) => isOverflowTarget(c)),
  ...TRAD_FIRST_ORDER.filter((c) => !isOverflowTarget(c)),
];

const STRATEGIES: RouterInputs["projection"]["compareWithdrawalStrategies"]["strategies"] =
  [
    { label: "Traditional first", mode: "waterfall", order: TRAD_FIRST_ORDER },
    {
      label: "Brokerage first",
      mode: "waterfall",
      order: BROKERAGE_FIRST_ORDER,
    },
    {
      label: WITHDRAWAL_ROUTING_MODE_LABELS.bracket_filling,
      mode: "bracket_filling",
    },
  ];

/** A named preset's row and "Your current plan" can legitimately describe
 *  the exact same run — e.g. a household already on Bracket Filling.
 *  Matches on BOTH the config (mode, and for waterfall, the resolved
 *  order) AND the computed output (lifetime tax, within a cent — the
 *  same tolerance convention used elsewhere for candidate scoring — and
 *  the depletion year): a config match with a different number would be
 *  a real bug worth surfacing, not something to silently annotate away. */
function ordersMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export function WithdrawalComparison({ selection }: { selection: Selection }) {
  const { data, isLoading } =
    trpc.projection.compareWithdrawalStrategies.useQuery(
      { ...selection, strategies: STRATEGIES },
      { placeholderData: (prev) => prev },
    );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
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
      const preset = STRATEGIES.find((p) => p.label === s.label);
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
      s.depletedYear === currentPlan.depletedYear
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
              <th className="px-2 py-2">Runs out?</th>
            </tr>
          </thead>
          <tbody>
            {data.strategies.map((s) => (
              <tr
                key={s.label}
                className={
                  s.label === best
                    ? "bg-green-50 font-medium"
                    : "isCurrentPlan" in s && s.isCurrentPlan
                      ? "bg-slate-50"
                      : undefined
                }
              >
                <td className="px-2 py-1.5 text-left">
                  {s.label}
                  {"isCurrentPlan" in s && s.isCurrentPlan && (
                    <span className="ml-1 text-[10px] text-slate-600">
                      your plan
                    </span>
                  )}
                  {matchesCurrentPlan(s) && (
                    <span className="text-faint ml-1 text-[10px]">
                      (same as your current plan)
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
                  {s.depletedYear ? (
                    <span className="text-red-700">yes — {s.depletedYear}</span>
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
