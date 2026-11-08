/** The toolbar's lenses: compare basis, baseline, income and confidence band. */
import { HelpTip } from "@/components/ui/help-tip";
import { PillBtn, LabeledPillGroup, ZoneSecondaryRow } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";

export function DisplaySecondaryRow({ state }: { state: ProjectionState }) {
  const {
    chartView,
    setChartView,
    showBars,
    setShowBars,
    showStabilityBars,
    setShowStabilityBars,
    showIncome,
    setShowIncome,
    fanBandRange,
    setFanBandRange,
    mcBandsByYear,
    hasIndividualAccountData,
  } = state;
  const hasMc = mcBandsByYear != null;
  // The Balance chart's bars come from per-account data, which a
  // Simple-tax-mode scenario doesn't have, so the toggle has nothing to show.
  const baselineUnavailable =
    chartView === "balance" && !hasIndividualAccountData;
  const baselineDisabledTitle = baselineUnavailable
    ? "Not available for this scenario — Simple tax mode doesn't track individual accounts, so there's no per-account breakdown to show as bars. Switch to Advanced tax mode to use this."
    : undefined;
  return (
    <ZoneSecondaryRow>
      {chartView !== "balance" && (
        <LabeledPillGroup
          label="Compare vs"
          helpTip={
            <HelpTip
              maxWidth={380}
              lines={[
                "Strategy: each year's spending as a % of what your withdrawal strategy actually targets that year (its real, guardrail/raise-adjusted number — not just year 1 grown by inflation). Measures self-consistency: is the strategy delivering what it promised itself?",
                "Budget: the same spending, but as a % of your stated retirement budget instead. Measures whether your real-world needs are met.",
                "For budget-based strategies (Fixed, Forgo, Guyton-Klinger) these two often look similar, since year-1 spending IS the budget for those — the gap opens up for portfolio-linked strategies (Constant %, Vanguard Dynamic) or once guardrails start adjusting spending away from the original budget.",
              ]}
            />
          }
        >
          <PillBtn
            active={chartView === "strategy"}
            onClick={() => setChartView("strategy")}
            label="Strategy"
          />
          <PillBtn
            active={chartView === "budget"}
            onClick={() => setChartView("budget")}
            label="Budget"
          />
        </LabeledPillGroup>
      )}
      <LabeledPillGroup label="Baseline">
        <PillBtn
          active={chartView === "balance" ? showBars : showStabilityBars}
          onClick={() =>
            chartView === "balance"
              ? setShowBars(true)
              : setShowStabilityBars(true)
          }
          label="On"
          disabled={baselineUnavailable}
          title={baselineDisabledTitle}
        />
        <PillBtn
          active={chartView === "balance" ? !showBars : !showStabilityBars}
          onClick={() =>
            chartView === "balance"
              ? setShowBars(false)
              : setShowStabilityBars(false)
          }
          label="Off"
          disabled={baselineUnavailable}
          title={baselineDisabledTitle}
        />
      </LabeledPillGroup>
      {chartView === "balance" && (
        <LabeledPillGroup
          label="Income"
          helpTip={
            <HelpTip
              maxWidth={320}
              text="Shows total portfolio withdrawal and Social Security income for each retirement year, on their own axis to the right — separate from the account balances the bars show. Both are your strategy's real computed numbers, not estimates."
            />
          }
        >
          <PillBtn
            active={showIncome}
            onClick={() => setShowIncome(true)}
            label="On"
          />
          <PillBtn
            active={!showIncome}
            onClick={() => setShowIncome(false)}
            label="Off"
          />
        </LabeledPillGroup>
      )}
      {hasMc && (
        <LabeledPillGroup
          label="Confidence Band"
          helpTip={
            <HelpTip
              maxWidth={360}
              lines={[
                "Confidence bands show the range of simulation outcomes.",
                <span key="p25">
                  <strong className="text-purple-300">50%</strong> — Middle 50%
                  of outcomes. Tightest view, shows the most likely range.
                </span>,
                <span key="p10">
                  <strong className="text-purple-300">80%</strong> — Middle 80%
                  of outcomes. Includes moderately good and bad scenarios.
                </span>,
                <span key="p5">
                  <strong className="text-purple-300">90%</strong> — Middle 90%
                  of outcomes. Widest view.
                </span>,
              ]}
            />
          }
        >
          <PillBtn
            active={fanBandRange === "off"}
            onClick={() => setFanBandRange("off")}
            label="Off"
          />
          <PillBtn
            active={fanBandRange === "p25-p75"}
            onClick={() => setFanBandRange("p25-p75")}
            label="50%"
          />
          <PillBtn
            active={fanBandRange === "p10-p90"}
            onClick={() => setFanBandRange("p10-p90")}
            label="80%"
          />
          <PillBtn
            active={fanBandRange === "p5-p95"}
            onClick={() => setFanBandRange("p5-p95")}
            label="90%"
          />
        </LabeledPillGroup>
      )}
    </ZoneSecondaryRow>
  );
}
