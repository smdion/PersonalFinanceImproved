"use client";

/** Chart controls bar — rendered inside each chart's header area.
 *  Contains: Balance/Strategy/Budget toggle, Baseline On/Off, Confidence Band range. */
import { HelpTip } from "@/components/ui/help-tip";
import { PillBtn, LabeledPillGroup } from "./pill-btn";
import type { ProjectionState } from "./projection-table-types";

export function ChartControls({ state }: { state: ProjectionState }) {
  const {
    chartView,
    setChartView,
    showBars,
    setShowBars,
    fanBandRange,
    setFanBandRange,
    mcBandsByYear,
    scenarioView,
    setScenarioView,
    coastFireAge,
  } = state;

  const hasMc = mcBandsByYear != null;
  const coastFireAvailable = coastFireAge != null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <LabeledPillGroup label="Show">
        <PillBtn
          active={chartView === "balance"}
          onClick={() => setChartView("balance")}
          label="Balance"
        />
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

      <div className="w-px h-4 bg-surface-strong" />

      <LabeledPillGroup
        label="Scenario"
        helpTip={
          <HelpTip
            maxWidth={380}
            lines={[
              "Active Plan: your plan as configured, with contributions continuing through retirement.",
              coastFireAvailable
                ? `Coast FIRE (Age ${coastFireAge}): contributions zeroed from age ${coastFireAge} onward — the earliest age that still passes.`
                : "Coast FIRE (Age N): contributions zeroed from your Coast FIRE age onward — the earliest age that still passes. Not yet available.",
              "Coast FIRE (Today): the SAME idea, but stopping right now instead of at the earliest passing age. Use this to see exactly what breaks (and when) if you stopped contributing today — often a shortfall in the years before 59½, which the passing-age view won't show since it's built to avoid it.",
            ]}
          />
        }
      >
        <PillBtn
          active={scenarioView === "baseline"}
          onClick={() => setScenarioView("baseline")}
          label="Active Plan"
        />
        <PillBtn
          active={scenarioView === "coastFire"}
          onClick={() => {
            if (coastFireAvailable) setScenarioView("coastFire");
          }}
          label={
            coastFireAvailable
              ? `Coast FIRE (Age ${coastFireAge})`
              : "Coast FIRE"
          }
          disabled={!coastFireAvailable}
        />
        <PillBtn
          active={scenarioView === "coastFireToday"}
          onClick={() => {
            if (coastFireAvailable) setScenarioView("coastFireToday");
          }}
          label="Coast FIRE (Today)"
          disabled={!coastFireAvailable}
        />
      </LabeledPillGroup>

      <div className="w-px h-4 bg-surface-strong" />

      <LabeledPillGroup label="Baseline">
        <PillBtn
          active={showBars}
          onClick={() => setShowBars(true)}
          label="On"
        />
        <PillBtn
          active={!showBars}
          onClick={() => setShowBars(false)}
          label="Off"
        />
      </LabeledPillGroup>

      {hasMc && (
        <>
          <div className="w-px h-4 bg-surface-strong" />
          <LabeledPillGroup
            label="Confidence Band"
            helpTip={
              <HelpTip
                maxWidth={360}
                lines={[
                  "Confidence bands show the range of simulation outcomes.",
                  <span key="p25">
                    <strong className="text-purple-300">50%</strong> — Middle
                    50% of outcomes. Tightest view, shows the most likely range.
                  </span>,
                  <span key="p10">
                    <strong className="text-purple-300">80%</strong> — Middle
                    80% of outcomes. Includes moderately good and bad scenarios.
                  </span>,
                  <span key="p5">
                    <strong className="text-purple-300">90%</strong> — Middle
                    90% of outcomes. Widest view.
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
        </>
      )}
    </div>
  );
}
