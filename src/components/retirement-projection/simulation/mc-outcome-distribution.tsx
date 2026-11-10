import { formatCurrency } from "@/lib/utils/format";
import type { OutcomeDistribution } from "./mc-simulation-types";
import { AssumptionRow } from "./assumption-row";

export type OutcomeDistributionPanelProps = {
  outcomeDistribution: OutcomeDistribution | undefined;
};

export function OutcomeDistributionPanel({
  outcomeDistribution,
}: OutcomeDistributionPanelProps) {
  return (
    <>
      {outcomeDistribution && (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-surface-sunken text-secondary px-4 py-3 text-sm font-medium">
            Outcome Distribution
          </div>
          <div className="text-muted space-y-2 px-4 py-4 text-sm">
            <AssumptionRow
              label="Median End Balance"
              value={formatCurrency(outcomeDistribution.medianEndBalance)}
              tip="50th percentile terminal portfolio value. When some scenarios deplete, the median still reflects surviving paths — which benefit from compounding — so it can appear high even with meaningful depletion risk."
            />
            <AssumptionRow
              label="P5 End Balance (worst realistic)"
              value={formatCurrency(outcomeDistribution.p5EndBalance)}
              highlight={outcomeDistribution.p5EndBalance <= 0}
              tip="Only 5% of scenarios end worse than this. If this is $0, a meaningful number of simulations fully depleted."
            />
            <AssumptionRow
              label="Simulated Withdrawal Range (p25–p75)"
              value={`${formatCurrency(outcomeDistribution.sustainableWithdrawalPV.p25)} – ${formatCurrency(outcomeDistribution.sustainableWithdrawalPV.p75)}`}
              tip="25th–75th percentile range of annual withdrawals across all simulation trials, in today's purchasing power. Unlike the deterministic estimate, this accounts for market volatility, sequence-of-returns risk, and tax gross-up."
            />
            <div className="border-subtle mt-2 border-t pt-2">
              <div className="text-label text-muted mb-1.5 font-medium">
                Terminal Balance Percentiles
              </div>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                {(
                  [
                    [
                      "p10",
                      outcomeDistribution.terminalBalance.p10,
                      "Bad luck",
                    ],
                    [
                      "p25",
                      outcomeDistribution.terminalBalance.p25,
                      "Below avg",
                    ],
                    [
                      "p50",
                      outcomeDistribution.terminalBalance.median,
                      "Typical",
                    ],
                    [
                      "p75",
                      outcomeDistribution.terminalBalance.p75,
                      "Above avg",
                    ],
                    [
                      "p90",
                      outcomeDistribution.terminalBalance.p90,
                      "Good luck",
                    ],
                  ] as const
                ).map(([label, val, desc]) => (
                  <div key={label}>
                    <div className="text-caption text-faint">{desc}</div>
                    <div
                      className={`font-medium ${val <= 0 ? "text-red-600" : "text-secondary"}`}
                    >
                      {formatCurrency(val)}
                    </div>
                    <div className="text-micro text-faint">{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <AssumptionRow
              label="Compute Time"
              value={`${(outcomeDistribution.computeTimeMs / 1000).toFixed(1)}s`}
              tip="Wall-clock time for the simulation run."
            />
          </div>
        </div>
      )}
    </>
  );
}
