"use client";

/**
 * Side-by-side lifetime-tax comparison of withdrawal-sequencing
 * strategies (roadmap #2). Runs `compareWithdrawalStrategies` with three
 * presets that are cleanly expressible through `withdrawalRoutingMode` +
 * `withdrawalOrder`:
 *  - Traditional first  → waterfall, pre-tax categories drained first
 *  - Brokerage first    → waterfall, taxable drained first
 *  - Tax-optimized      → bracket_filling (the engine's dynamic mode)
 * ("Roth first" is deliberately omitted — it needs a tax-preference
 * override, not a category order, which this procedure doesn't take.)
 */
import type { RouterInputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDefaultDecumulationOrder,
  isOverflowTarget,
} from "@/lib/config/account-types";

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
    { label: "Tax-optimized", mode: "bracket_filling" },
  ];

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
                  s.label === best ? "bg-green-50 font-medium" : undefined
                }
              >
                <td className="px-2 py-1.5 text-left">
                  {s.label}
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
