/** The Simulation bar's stat tiles. */
import { HelpTip } from "@/components/ui/help-tip";
import { STRATEGY_CONFIG_BY_STORED_KEY } from "@/lib/config/stored-withdrawal-strategy";
import { strategySpending } from "@/lib/pure/retirement/strategy-spending";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types";
import type { ProjectionState } from "./projection-table-types";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export type McRateTilesProps = {
  si: NonNullable<
    Extract<
      NonNullable<ProjectionState["mcQuery"]["data"]>,
      { simulationInputs: unknown }
    >["simulationInputs"]
  >;
  mixLines: string[];
  gkImpliedRate: number | null;
};

export function McRateTiles({ si, mixLines, gkImpliedRate }: McRateTilesProps) {
  return (
    <>
      <div className="text-center">
        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
          {formatPercent(si.blendedReturn, 2)}
          <HelpTip
            maxWidth={280}
            lines={[
              "Blended expected annual return across your current glide-path allocation:",
              ...(mixLines.length > 0
                ? mixLines
                : ["(no asset-class weights available)"]),
              "Same for every trial and every withdrawal strategy — strategies decide how much gets spent, not how the portfolio itself performs. This shifts over time as your glide path shifts allocation with age.",
            ]}
          />
        </div>
        <div className="text-micro text-faint">return</div>
        <div className="text-micro text-faint">5–10%</div>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
          {formatPercent(si.blendedVol, 2)}
          <HelpTip
            maxWidth={280}
            lines={[
              "Blended annual volatility (standard deviation of returns) across your current glide-path allocation:",
              ...(mixLines.length > 0
                ? mixLines
                : ["(no asset-class weights available)"]),
              "Higher volatility means a wider range of possible outcomes per trial — this is what actually creates the spread between a “bad luck” and “good luck” simulated future, same for every withdrawal strategy.",
            ]}
          />
        </div>
        <div className="text-micro text-faint">volatility</div>
        <div className="text-micro text-faint">8–16%</div>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
          {gkImpliedRate != null
            ? formatPercent(gkImpliedRate, 2)
            : formatPercent(si.withdrawalRate, 2)}
          {gkImpliedRate != null ? (
            <HelpTip
              maxWidth={260}
              text={`Your Retirement Budget doesn't set a rate directly — Guyton-Klinger captures ${formatPercent(gkImpliedRate, 2)} on your first retirement year (what the portfolio pays that year — spending less Social Security — ÷ your projected portfolio balance) and defends THIS rate with guardrails for the rest of retirement. It's not the "Initial Withdrawal Rate" setting (${formatPercent(si.withdrawalRate, 2)}) — that field is never read by any strategy, including this one.`}
            />
          ) : (
            <HelpTip
              maxWidth={260}
              text={`Your household's "Initial Withdrawal Rate" setting (${formatPercent(si.withdrawalRate, 2)}), shown here only as a reference figure — your active strategy (${si.withdrawalStrategy.replace(/_/g, " ")}) computes spending its own way and does NOT read this number.`}
            />
          )}
        </div>
        {/* For every other strategy this is still
          the flat "Initial Withdrawal Rate" household
          setting, an input echo like the return/volatility/
          inflation figures beside it — not what any
          strategy's spending math actually reads. For
          Guyton-Klinger specifically, it's replaced with the
          rate GK actually captured and will defend — a real
          number, not a reference figure — since a user
          could otherwise read "ref. rate" here and
          reasonably ask why GK's spending seems to track it
          anyway. The non-GK tooltip used to also name-drop
          GK ("...which is what you'd see here if it were
          active") as a preemptive explanation for THAT
          comparison — but it showed unconditionally for
          every other strategy too, so someone who's never
          touched GK got a confusing, unprompted mention of
          a strategy they're not using. Dropped; the "shown here only as a
          reference figure" framing already covers why the
          number exists without needing the GK aside. */}
        <div className="text-micro text-faint">
          {gkImpliedRate != null ? "GK anchor rate" : "ref. rate"}
        </div>
        <div className="text-micro text-faint">
          {gkImpliedRate != null ? "captured, not chosen" : "3–5%"}
        </div>
      </div>
    </>
  );
}

export type McRunTilesProps = {
  firstDecumYear: EngineDecumulationYear | null;
  deflate: ProjectionState["deflate"];
  si: NonNullable<
    Extract<
      NonNullable<ProjectionState["mcQuery"]["data"]>,
      { simulationInputs: unknown }
    >["simulationInputs"]
  >;
  dollarMode: ProjectionState["dollarMode"];
  mcr: NonNullable<NonNullable<ProjectionState["mcQuery"]["data"]>["result"]>;
};

export function McRunTiles({
  firstDecumYear,
  deflate,
  si,
  dollarMode,
  mcr,
}: McRunTilesProps) {
  return (
    <>
      {firstDecumYear && (
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
            {formatCurrency(
              deflate(strategySpending(firstDecumYear), firstDecumYear.year),
            )}
            <HelpTip
              maxWidth={260}
              text={`Your ${firstDecumYear.year} retirement year's actual spending, as computed by your ACTIVE withdrawal strategy (${STRATEGY_CONFIG_BY_STORED_KEY[si.withdrawalStrategy]?.label ?? si.withdrawalStrategy}) and any changes you set for that year -- not a flat rate applied to today's balance. Shown in ${dollarMode === "nominal" ? "future" : "today's"} dollars, matching the Dollars toggle above the chart.`}
            />
          </div>
          <div className="text-micro text-faint">starting income</div>
          {/* A unit label, not an amount. */}
          <div className="text-micro text-faint" data-privacy-visible>
            {dollarMode === "nominal" ? "future $" : "today's $"}
          </div>
        </div>
      )}
      <div className="text-center">
        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
          {formatPercent(si.inflationRate, 2)}
          <HelpTip
            maxWidth={280}
            text={`Your inflation rate, varied in each trial (±${formatPercent(si.inflationRisk.stdDev, 2)} standard deviation a year) — and your post-retirement raise (${formatPercent(si.postRetirementInflationRate, 2)}) moves with it, keeping your gap between the two. Each year of a trial draws its own inflation, carried through spending, Social Security and tax brackets. Today's dollars use each trial's own inflation. Strategies react differently: a fixed-dollar strategy raises spending with inflation every year regardless, while a guardrail strategy like "Forgo Inflation After Loss" can skip that year's raise after a bad market year.`}
          />
        </div>
        <div className="text-micro text-faint">inflation</div>
        <div className="text-micro text-faint">2–3%</div>
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
          {mcr.numTrials.toLocaleString()}
          <HelpTip
            maxWidth={280}
            text="Number of independent simulated lifetimes run, each with its own randomized sequence of yearly returns and inflation. Your strategy's success rate is simply the share of these trials that never run out of money — more trials means a more stable estimate of that share, at the cost of slower simulation."
          />
        </div>
        <div className="text-micro text-faint">trials</div>
        <div className="text-micro text-faint">1K+</div>
      </div>
    </>
  );
}
