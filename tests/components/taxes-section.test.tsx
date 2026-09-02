/**
 * Multi-year withdrawal-policy optimizer, Phase 4 —
 * `TaxesSection`'s live "Currently recommended: X%" note next to the
 * Bracket Ceiling control, and its "Apply" action.
 *
 * `TaxesSection` is a documented pure-presentational leaf
 * (retirement-sections-smoke.test.tsx) — the optimizer result is passed
 * in as a plain `bracketOptimizerResult` prop (owned/queried by the
 * parent, retirement-profile-tab.tsx), not fetched by this component
 * itself, so no tRPC mocking is needed here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  TaxesSection,
  type BracketOptimizerResult,
} from "@/components/retirement/sections/taxes";
import type { Settings } from "@/components/retirement/sections/types";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    personId: 1,
    retirementAge: 65,
    endAge: 90,
    returnAfterRetirement: "0.05",
    annualInflation: "0.03",
    salaryAnnualIncrease: "0.02",
    withdrawalRate: "0.04",
    taxMultiplier: "1.0",
    rothBracketTarget: "0.12",
    socialSecurityMonthly: "2500",
    ssStartAge: 67,
    withdrawalStrategy: "fixed",
    enableRothConversions: false,
    rmdSmoothingEnabled: false,
    ...overrides,
  };
}

function renderTaxesSection(
  settingsOverrides: Partial<Settings> = {},
  bracketOptimizerResult?: BracketOptimizerResult,
  mutate = vi.fn(),
) {
  const settings = baseSettings(settingsOverrides);
  render(
    <TaxesSection
      settings={settings}
      selectedScenario={null}
      upsertSettings={{ mutate }}
      isEditable={true}
      bracketOptimizerResult={bracketOptimizerResult}
    />,
  );
  return { settings, mutate };
}

describe("TaxesSection — withdrawal bracket optimizer recommendation", () => {
  it("doesn't render a recommendation while the query hasn't resolved yet (prop undefined)", () => {
    renderTaxesSection({}, undefined);
    expect(screen.queryByText(/Currently recommended/)).not.toBeInTheDocument();
  });

  it("doesn't render a recommendation when the current setting is already optimal", () => {
    renderTaxesSection({}, { recommendedTarget: null, currentTarget: 0.12 });
    expect(screen.queryByText(/Currently recommended/)).not.toBeInTheDocument();
  });

  it("renders the recommended target when one exists", () => {
    renderTaxesSection({}, { recommendedTarget: 0.22, currentTarget: 0.12 });
    expect(screen.getByText(/Currently recommended/)).toBeInTheDocument();
    expect(screen.getByText("22%")).toBeInTheDocument();
    expect(screen.getByText("Apply")).toBeInTheDocument();
  });

  it("doesn't render Apply when not editable (read-only viewer)", () => {
    const settings = baseSettings();
    render(
      <TaxesSection
        settings={settings}
        selectedScenario={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={false}
        bracketOptimizerResult={{
          recommendedTarget: 0.22,
          currentTarget: 0.12,
        }}
      />,
    );
    expect(screen.getByText(/Currently recommended/)).toBeInTheDocument();
    expect(screen.queryByText("Apply")).not.toBeInTheDocument();
  });

  it("Apply sets only rothBracketTarget when conversions and smoothing are both off", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: false, rmdSmoothingEnabled: false },
      { recommendedTarget: 0.22, currentTarget: 0.12 },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0][0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBeUndefined();
    expect(patch.rmdSmoothingMaxBracketTarget).toBeUndefined();
    expect(screen.queryByText(/RMD Smoothing ceiling/)).not.toBeInTheDocument();
  });

  it("Apply also sets rothConversionTarget when enableRothConversions is on", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: true, rmdSmoothingEnabled: false },
      { recommendedTarget: 0.22, currentTarget: 0.12 },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0][0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBe("0.22");
    expect(patch.rmdSmoothingMaxBracketTarget).toBeUndefined();
  });

  it("Apply also sets rmdSmoothingMaxBracketTarget when rmdSmoothingEnabled is on, discloses it, and does NOT gate this on enableRothConversions", () => {
    // enableRothConversions is OFF here -- if the ceiling update were
    // (wrongly) gated on that toggle instead of rmdSmoothingEnabled, this
    // would fail to update it. See PLAN-v0.7.10-multi-year-withdrawal-
    // optimizer.md's Phase 4 correction.
    const { mutate } = renderTaxesSection(
      { enableRothConversions: false, rmdSmoothingEnabled: true },
      { recommendedTarget: 0.22, currentTarget: 0.12 },
    );
    expect(screen.getByText(/RMD Smoothing ceiling/)).toBeInTheDocument();
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0][0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBeUndefined();
    expect(patch.rmdSmoothingMaxBracketTarget).toBe("0.22");
  });

  it("Apply sets all three fields when both conversions and smoothing are on", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: true, rmdSmoothingEnabled: true },
      { recommendedTarget: 0.22, currentTarget: 0.12 },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0][0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBe("0.22");
    expect(patch.rmdSmoothingMaxBracketTarget).toBe("0.22");
  });
});
