import { HelpTip } from "@/components/ui/help-tip";
import { PillBtn, LabeledPillGroup } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";

export function ScenarioPills({
  coastFireAvailable,
  state,
  coastFireAge,
  projectionView,
  setProjectionView,
}: {
  coastFireAvailable: boolean;
  state: ProjectionState;
  coastFireAge: number | null;
  projectionView: ProjectionState["projectionView"];
  setProjectionView: ProjectionState["setProjectionView"];
}) {
  return (
    <LabeledPillGroup
      label="Scenario"
      size="lg"
      helpTip={
        <HelpTip
          maxWidth={380}
          lines={[
            "Baseline: your projection as configured, with contributions continuing through retirement.",
            coastFireAvailable
              ? `Coast FIRE (${state.ageLabel(coastFireAge!)}): contributions zeroed from then on — the earliest year that still passes.`
              : "Coast FIRE: contributions zeroed from your Coast FIRE year on — the earliest year that still passes. Not yet available.",
            "Coast FIRE (Today): the SAME idea, but stopping right now instead of at the earliest passing age. Use this to see exactly what breaks (and when) if you stopped contributing today — often a shortfall in the years before 59½, which the passing-age view won't show since it's built to avoid it.",
            'Coast FIRE (Custom): check any age you pick, not just the earliest passing one or today — pick an age and press "Check this age" to see whether it passes.',
            "Initial Rate: an alternate simulation where year 1's spending is set from your Initial Withdrawal Rate setting × starting balance instead of your stated budget or the amount you set — your budget is ignored entirely for the starting point. Every year after that still runs your ACTIVE strategy's own ongoing rules (guardrails, decline schedule, etc.) unchanged — this only changes where the number starts, not how it evolves. Computed on demand (not preloaded in the background like Coast FIRE), so the first switch takes a few seconds.",
          ]}
        />
      }
    >
      <PillBtn
        size="lg"
        tone="compute"
        active={projectionView === "baseline"}
        onClick={() => setProjectionView("baseline")}
        label="Baseline"
      />
      <PillBtn
        size="lg"
        tone="compute"
        active={projectionView === "coastFire"}
        onClick={() => {
          if (coastFireAvailable) setProjectionView("coastFire");
        }}
        label={
          coastFireAvailable
            ? `Coast FIRE (${state.ageLabel(coastFireAge!)})`
            : "Coast FIRE"
        }
        disabled={!coastFireAvailable}
      />
      <PillBtn
        size="lg"
        tone="compute"
        active={projectionView === "coastFireToday"}
        onClick={() => {
          if (coastFireAvailable) setProjectionView("coastFireToday");
        }}
        label="Coast FIRE (Today)"
        disabled={!coastFireAvailable}
      />
      <PillBtn
        size="lg"
        tone="compute"
        active={projectionView === "coastFireCustom"}
        onClick={() => setProjectionView("coastFireCustom")}
        label="Coast FIRE (Custom)"
      />
      <PillBtn
        size="lg"
        tone="compute"
        active={projectionView === "rateSeeded"}
        onClick={() => setProjectionView("rateSeeded")}
        label="Initial Rate"
      />
    </LabeledPillGroup>
  );
}
