/**
 * `TaxesSection`'s live "Currently recommended: X%" note next to the
 * Bracket Ceiling control, and its "Apply" action (part of the multi-year
 * withdrawal-policy optimizer).
 *
 * `TaxesSection` is a documented pure-presentational leaf
 * (retirement-sections-smoke.test.tsx) — the optimizer result is passed
 * in as a plain `optimizer` prop (owned/queried by the
 * parent, retirement-profile-tab.tsx), not fetched by this component
 * itself, so no tRPC mocking is needed here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaxesSection } from "@/components/retirement/sections/taxes";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import type { Settings } from "@/components/retirement/sections/types";
import { makeSettings } from "./fixtures/retirement-settings";
import { expectLabelReachesControl } from "./label-click";
import { BROKERAGE_FIRST_MAGI_NOTE } from "@/lib/config/withdrawal-order-labels";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return makeSettings({
    endAge: 90,
    salaryAnnualIncrease: "0.02",
    rothBracketTarget: "0.12",
    socialSecurityMonthly: "2500",
    ...overrides,
  });
}

function renderTaxesSection(
  settingsOverrides: Partial<Settings> = {},
  bracketOptimizerResult?: BracketOptimizerResult,
  mutate = vi.fn(),
  notes: string[] = [],
) {
  const settings = baseSettings(settingsOverrides);
  render(
    <TaxesSection
      settings={settings}
      selectedScenario={null}
      upsertSettings={{ mutate }}
      isEditable={true}
      optimizer={
        bracketOptimizerResult && { result: bracketOptimizerResult, notes }
      }
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
    renderTaxesSection(
      {},
      { recommendedTarget: null, currentTarget: 0.12, candidates: [] },
    );
    expect(screen.queryByText(/Currently recommended/)).not.toBeInTheDocument();
  });

  it("renders the recommended target when one exists", () => {
    renderTaxesSection(
      {},
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
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
        optimizer={{
          result: {
            recommendedTarget: 0.22,
            currentTarget: 0.12,
            candidates: [],
          },
          notes: [],
        }}
      />,
    );
    expect(screen.getByText(/Currently recommended/)).toBeInTheDocument();
    expect(screen.queryByText("Apply")).not.toBeInTheDocument();
  });

  it("shows what the optimizer's projection left out", () => {
    renderTaxesSection(
      {},
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
      vi.fn(),
      ["An optimizer note"],
    );
    expect(screen.getByText("An optimizer note")).toBeInTheDocument();
  });

  it("Apply sets only rothBracketTarget when conversions and smoothing are both off", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: false, rmdSmoothingEnabled: false },
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBeUndefined();
    expect(patch.rmdSmoothingMaxBracketTarget).toBeUndefined();
    expect(screen.queryByText(/RMD Smoothing ceiling/)).not.toBeInTheDocument();
  });

  it("Apply also sets rothConversionTarget when enableRothConversions is on and a rate is saved", () => {
    const { mutate } = renderTaxesSection(
      {
        enableRothConversions: true,
        rmdSmoothingEnabled: false,
        rothConversionTarget: "0.12",
      },
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBe("0.22");
    expect(patch.rmdSmoothingMaxBracketTarget).toBeUndefined();
  });

  it("Apply also sets rmdSmoothingMaxBracketTarget when rmdSmoothingEnabled is on, discloses it, and does NOT gate this on enableRothConversions", () => {
    // enableRothConversions is OFF here -- if the ceiling update were
    // (wrongly) gated on that toggle instead of rmdSmoothingEnabled, this
    // would fail to update it.
    const { mutate } = renderTaxesSection(
      { enableRothConversions: false, rmdSmoothingEnabled: true },
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
    expect(screen.getByText(/RMD Smoothing ceiling/)).toBeInTheDocument();
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBeUndefined();
    expect(patch.rmdSmoothingMaxBracketTarget).toBe("0.22");
  });

  it("Apply leaves an unset conversion rate unset: the conversion follows the ceiling it sets", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: true, rothConversionTarget: null },
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch).not.toHaveProperty("rothConversionTarget");
  });

  it("Apply of a 0% target leaves a saved conversion rate as it is (a rate of 0 would turn conversions off)", () => {
    const { mutate } = renderTaxesSection(
      { enableRothConversions: true, rothConversionTarget: "0.12" },
      { recommendedTarget: 0, currentTarget: 0.12, candidates: [] },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0");
    expect(patch).not.toHaveProperty("rothConversionTarget");
  });

  it("Apply sets all three fields when both conversions and smoothing are on", () => {
    const { mutate } = renderTaxesSection(
      {
        enableRothConversions: true,
        rmdSmoothingEnabled: true,
        rothConversionTarget: "0.12",
      },
      { recommendedTarget: 0.22, currentTarget: 0.12, candidates: [] },
    );
    screen.getByText("Apply").click();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.rothBracketTarget).toBe("0.22");
    expect(patch.rothConversionTarget).toBe("0.22");
    expect(patch.rmdSmoothingMaxBracketTarget).toBe("0.22");
  });
});

describe("TaxesSection — Roth conversion rate picker", () => {
  const picker = () =>
    screen.getByLabelText(
      "Roth conversion target bracket",
    ) as HTMLSelectElement;
  const shown = (select: HTMLSelectElement) =>
    select.options[select.selectedIndex]!.textContent;

  it("with no rate saved, shows the ceiling it follows, as an entry that can't be picked", () => {
    renderTaxesSection({
      enableRothConversions: true,
      rothBracketTarget: "0.22",
      rothConversionTarget: null,
    });
    expect(picker().value).toBe("");
    expect(shown(picker())).toBe("Same as Bracket Ceiling (22%)");
    expect(picker().options[picker().selectedIndex]!.disabled).toBe(true);
  });

  it.each([
    ["0.12", "12%"],
    ["0", "Off (rate 0)"],
    ["0.32", "32%"],
    ["0.37", "37%"],
  ])("a saved rate of %s shows as itself (%s), selected", (saved, label) => {
    renderTaxesSection({
      enableRothConversions: true,
      rothConversionTarget: saved,
    });
    expect(picker().value).toBe(String(Number(saved)));
    expect(shown(picker())).toBe(label);
    expect(picker().options[picker().selectedIndex]!.disabled).toBe(false);
    expect(screen.queryByText(/Same as Bracket Ceiling/)).toBeNull();
  });
});

describe("TaxesSection — Bracket Ceiling picker", () => {
  it.each([
    ["0.12", "12% (~$116k MFJ)"],
    ["0", "0%"],
    ["0.35", "35%"],
    ["0.37", "37%"],
  ])("a saved ceiling of %s shows as itself (%s), selected", (saved, label) => {
    renderTaxesSection({ rothBracketTarget: saved });
    const select = screen.getByLabelText(/Bracket Ceiling/, {
      selector: "select",
    }) as HTMLSelectElement;
    expect(select.value).toBe(String(Number(saved)));
    expect(select.options[select.selectedIndex]!.textContent).toBe(label);
  });
});

describe("TaxesSection — Withdrawal Routing (persisted default)", () => {
  it("defaults the select to Bracket Filling when the household has no setting yet", () => {
    renderTaxesSection({ withdrawalRoutingMode: undefined });
    const select = screen.getByDisplayValue(
      "Bracket Filling (default)",
    ) as HTMLSelectElement;
    expect(select.value).toBe("bracket_filling");
  });

  it("reflects a persisted non-default mode", () => {
    renderTaxesSection({ withdrawalRoutingMode: "waterfall" });
    const select = screen.getByDisplayValue("Waterfall") as HTMLSelectElement;
    expect(select.value).toBe("waterfall");
  });

  it("saves the chosen mode via upsertSettings, scoped to this profile", () => {
    const { mutate, settings } = renderTaxesSection({
      withdrawalRoutingMode: "bracket_filling",
    });
    const select = screen.getByDisplayValue("Bracket Filling (default)");
    select.dispatchEvent(new Event("focus"));
    (select as HTMLSelectElement).value = "percentage";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(mutate).toHaveBeenCalled();
    const patch = mutate.mock.calls[0]![0];
    expect(patch.withdrawalRoutingMode).toBe("percentage");
    expect(patch.profileId).toBe(settings.profileId);
  });
});

describe("TaxesSection — Withdrawal Order / Splits (persisted defaults)", () => {
  it("renders the order editor and reorders through upsertSettings, scoped to this profile", () => {
    const { mutate, settings } = renderTaxesSection({
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    // Each account past the first has a "Move <cat> left" button.
    fireEvent.click(screen.getByTitle("Move 403b left"));
    expect(mutate).toHaveBeenCalledTimes(1);
    const patch = mutate.mock.calls[0]![0];
    expect(patch.withdrawalOrder).toEqual([
      "403b",
      "401k",
      "ira",
      "brokerage",
      "hsa",
    ]);
    expect(patch.profileId).toBe(settings.profileId);
  });

  it("offers no reset when the order was never customized", () => {
    renderTaxesSection({ withdrawalOrder: undefined });
    expect(
      screen.queryByText("Reset to default order"),
    ).not.toBeInTheDocument();
  });

  it("clears the order column to null via the reset action", () => {
    const { mutate } = renderTaxesSection({
      withdrawalOrder: ["hsa", "brokerage", "ira", "403b", "401k"],
    });
    fireEvent.click(screen.getByText("Reset to default order"));
    expect(mutate.mock.calls[0]![0].withdrawalOrder).toBeNull();
  });

  it("hides the splits grid unless routing mode is percentage", () => {
    renderTaxesSection({ withdrawalRoutingMode: "waterfall" });
    expect(screen.queryByText("Withdrawal Splits")).not.toBeInTheDocument();
  });

  it("shows the splits grid for percentage mode and saves an edited draft on Save", () => {
    const { mutate } = renderTaxesSection({
      withdrawalRoutingMode: "percentage",
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        hsa: 0.1,
        brokerage: 0.3,
      },
    });
    expect(screen.getByText("Withdrawal Splits")).toBeInTheDocument();
    // No write until Save.
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0]!, { target: { value: "40" } });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save splits"));
    expect(mutate).toHaveBeenCalledTimes(1);
    const patch = mutate.mock.calls[0]![0];
    expect(patch.withdrawalSplits["401k"]).toBeCloseTo(0.4);
    expect(patch.withdrawalSplits.ira).toBeCloseTo(0.25);
  });
});

describe("TaxesSection — labels", () => {
  it("clicking Bracket Ceiling and Withdrawal Routing reaches their selects", () => {
    renderTaxesSection();
    expectLabelReachesControl("Bracket Ceiling");
    expectLabelReachesControl("Withdrawal Routing");
  });
});

describe("TaxesSection — brokerage-first note", () => {
  it("shows the MAGI note for brokerage-first with ACA and IRMAA awareness off", () => {
    renderTaxesSection({
      discretionaryWithdrawalOrder: "brokerage_first",
      enableAcaAwareness: false,
      enableIrmaaAwareness: false,
    });
    expect(screen.getByText(BROKERAGE_FIRST_MAGI_NOTE)).toBeInTheDocument();
  });

  it("shows no note for Roth-first", () => {
    renderTaxesSection({
      discretionaryWithdrawalOrder: "roth_first",
      enableAcaAwareness: true,
      enableIrmaaAwareness: true,
    });
    expect(
      screen.queryByText(BROKERAGE_FIRST_MAGI_NOTE),
    ).not.toBeInTheDocument();
  });
});
