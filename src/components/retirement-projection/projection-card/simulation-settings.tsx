/** The toolbar's simulation settings: preset, trials and tax mode. */
import { HelpTip } from "@/components/ui/help-tip";
import { PillBtn, LabeledPillGroup, LabeledSelect } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";

export function SimulationSettings({ state }: { state: ProjectionState }) {
  const {
    mcPreset,
    setMcPreset,
    mcTrials,
    setMcTrials,
    mcTaxMode,
    setMcTaxMode,
    setShowMethodology,
  } = state;
  return (
    <>
      <LabeledSelect
        label="Preset"
        value={mcPreset}
        onChange={(e) => setMcPreset(e.target.value as typeof mcPreset)}
        title="Simulation preset"
        helpTip={
          <HelpTip
            maxWidth={420}
            lines={[
              <span key="det">
                <strong className="text-blue-300">Deterministic</strong> —
                Single fixed-rate projection using your configured return rates.
                Shows one possible future, no randomness.
              </span>,
              <span key="agg">
                <strong className="text-red-300">Aggressive</strong> — Full
                historical returns, 0.9× vol, high equity (95%→35%). Money Guy /
                Bogleheads &quot;age - 20&quot; bonds rule.
              </span>,
              <span key="def">
                <strong className="text-green-300">Default</strong> — Historical
                returns, standard vol, hybrid FIRE glide path (90%→50% floor).
                Vanguard TDF accumulation + Kitces rising equity.
              </span>,
              <span key="con">
                <strong className="text-amber-300">Conservative</strong> —
                Forward-looking returns (~5% equity), +15% vol, heavy bonds
                (75%→15%). Vanguard VCMM / JP Morgan LTCMA.
              </span>,
              <span key="cus">
                <strong className="text-purple-300">Custom</strong> — Your own
                returns, volatility and glide path, with no preset adjustments.
              </span>,
            ]}
          />
        }
      >
        <option value="aggressive">Aggressive</option>
        <option value="default">Default</option>
        <option value="conservative">Conservative</option>
        <option value="custom">Custom</option>
      </LabeledSelect>
      <span className="text-caption text-faint basis-full">
        Sets the Simulation and strategy comparison. The year-by-year
        projection, Coast FIRE and the glide-path check stay on Default.
      </span>
      <LabeledSelect
        label="Trials"
        value={mcTrials}
        onChange={(e) => setMcTrials(Number(e.target.value))}
        title="Number of simulation trials"
      >
        <option value={500}>500</option>
        <option value={1000}>1,000</option>
        <option value={2500}>2,500</option>
        <option value={5000}>5,000</option>
      </LabeledSelect>
      <LabeledPillGroup
        label="Tax Mode"
        helpTip={
          <HelpTip
            maxWidth={360}
            lines={[
              <span key="simple">
                <strong className="text-blue-300">Simple</strong> — Single
                portfolio, no tax. Comparable to cFIREsim/FireCalc.
              </span>,
              <span key="advanced">
                <strong className="text-orange-300">Advanced</strong> — Full
                multi-account tax-aware simulation with gross-up and bracket
                filling.
              </span>,
            ]}
          />
        }
      >
        <PillBtn
          active={mcTaxMode === "simple"}
          onClick={() => setMcTaxMode("simple")}
          label="Simple"
        />
        <PillBtn
          active={mcTaxMode === "advanced"}
          onClick={() => setMcTaxMode("advanced")}
          label="Advanced"
        />
      </LabeledPillGroup>
      <button
        type="button"
        onClick={() => setShowMethodology(true)}
        className="text-caption whitespace-nowrap text-blue-500 underline hover:text-blue-600"
      >
        How does this work?
      </button>
    </>
  );
}
