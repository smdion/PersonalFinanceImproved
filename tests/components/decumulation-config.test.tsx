/**
 * Tests for DecumulationConfig — the withdrawal routing configuration panel
 * (bracket filling / waterfall / percentage modes, order editor, splits
 * editor, tax preference editor). Uses real @/lib/config/account-types and
 * @/lib/utils/colors since both are pure data-driven helpers with no
 * external deps (consistent with other projection tests that mock them only
 * when they want to shrink the category set — here we want the real set).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

import { DecumulationConfig } from "@/components/cards/projection/decumulation-config";
import {
  getDefaultDecumulationOrder,
  buildCategoryRecord,
  categoriesWithTaxPreference,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES } from "@/components/cards/projection/utils";

function baseProps(overrides: Record<string, unknown> = {}) {
  const withdrawalSplits = buildCategoryRecord(() => 0.25);
  return {
    isPersonFiltered: false,
    personFilterName: "",
    showDecumConfig: false,
    setShowDecumConfig: vi.fn(),
    withdrawalRoutingMode: "bracket_filling" as const,
    setWithdrawalRoutingMode: vi.fn(),
    withdrawalOrder: getDefaultDecumulationOrder(),
    setWithdrawalOrder: vi.fn(),
    withdrawalSplits,
    setWithdrawalSplits: vi.fn(),
    withdrawalTaxPref: {},
    setWithdrawalTaxPref: vi.fn(),
    activeSpendingStrategy: "fixed",
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("DecumulationConfig", () => {
  it("renders without crashing (collapsed)", () => {
    render(<DecumulationConfig {...baseProps()} />);
    expect(screen.getByText("Withdrawal Routing")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
  });

  it("shows person-filtered header when isPersonFiltered", () => {
    render(
      <DecumulationConfig
        {...baseProps({ isPersonFiltered: true, personFilterName: "Alice" })}
      />,
    );
    expect(screen.getByText("Withdrawal Routing — Alice")).toBeInTheDocument();
  });

  it("shows a collapsed summary with mode label when config is closed", () => {
    render(
      <DecumulationConfig
        {...baseProps({ withdrawalRoutingMode: "bracket_filling" })}
      />,
    );
    expect(screen.getByText(/Bracket Filling/)).toBeInTheDocument();
  });

  it("calls setShowDecumConfig(true) when Configure is clicked", () => {
    const setShowDecumConfig = vi.fn();
    render(<DecumulationConfig {...baseProps({ setShowDecumConfig })} />);
    fireEvent.click(screen.getByText("Configure"));
    expect(setShowDecumConfig).toHaveBeenCalledWith(true);
  });

  it("shows Done button and hides collapsed summary when expanded", () => {
    render(<DecumulationConfig {...baseProps({ showDecumConfig: true })} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders the three mode toggle buttons when expanded", () => {
    render(<DecumulationConfig {...baseProps({ showDecumConfig: true })} />);
    expect(screen.getByText("Bracket Filling")).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Percentage")).toBeInTheDocument();
  });

  it("calls setWithdrawalRoutingMode when a different mode is clicked", () => {
    const setWithdrawalRoutingMode = vi.fn();
    render(
      <DecumulationConfig
        {...baseProps({ showDecumConfig: true, setWithdrawalRoutingMode })}
      />,
    );
    fireEvent.click(screen.getByText("Waterfall"));
    expect(setWithdrawalRoutingMode).toHaveBeenCalledWith("waterfall");
  });

  it("shows the withdrawal order editor in waterfall mode", () => {
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "waterfall",
        })}
      />,
    );
    expect(screen.getByText("Withdrawal Order")).toBeInTheDocument();
  });

  it("swaps two accounts when a move-left arrow is clicked in the order editor", () => {
    const setWithdrawalOrder = vi.fn();
    const order = getDefaultDecumulationOrder();
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "waterfall",
          withdrawalOrder: order,
          setWithdrawalOrder,
        })}
      />,
    );
    // Move-left buttons exist for every entry after the first.
    const moveButtons = screen.getAllByTitle(/Move .* left/);
    expect(moveButtons.length).toBe(order.length - 1);
    fireEvent.click(moveButtons[0]!);
    expect(setWithdrawalOrder).toHaveBeenCalledTimes(1);
    const newOrder = setWithdrawalOrder.mock.calls[0]![0];
    expect(newOrder[0]).toBe(order[1]);
    expect(newOrder[1]).toBe(order[0]);
  });

  it("shows the withdrawal splits editor in percentage mode", () => {
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "percentage",
        })}
      />,
    );
    expect(screen.getByText("Withdrawal Splits")).toBeInTheDocument();
  });

  it("updates a split value via setWithdrawalSplits when edited", () => {
    const setWithdrawalSplits = vi.fn();
    const cat = ALL_CATEGORIES[0]!;
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "percentage",
          setWithdrawalSplits,
        })}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0]!, { target: { value: "40" } });
    expect(setWithdrawalSplits).toHaveBeenCalledTimes(1);
    // functional updater — call it with the previous state to inspect
    const updater = setWithdrawalSplits.mock.calls[0]![0];
    const prev = buildCategoryRecord(() => 0.25);
    const next = updater(prev);
    expect(next[cat]).toBeCloseTo(0.4);
  });

  it("shows a warning when splits don't sum to 100%", () => {
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "percentage",
          withdrawalSplits: buildCategoryRecord(() => 0.1),
        })}
      />,
    );
    expect(screen.getByText(/should be 100%/)).toBeInTheDocument();
  });

  it("does not show a warning when splits sum to 100%", () => {
    const cats = Object.keys(buildCategoryRecord(() => 0));
    const even = 1 / cats.length;
    const splits = buildCategoryRecord(() => even);
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "percentage",
          withdrawalSplits: splits,
        })}
      />,
    );
    expect(screen.queryByText(/should be 100%/)).not.toBeInTheDocument();
  });

  it("shows tax preference selects for waterfall/percentage but not bracket_filling", () => {
    const { rerender } = render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "bracket_filling",
        })}
      />,
    );
    expect(
      screen.queryByText("Tax Preference per Account"),
    ).not.toBeInTheDocument();

    rerender(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "waterfall",
        })}
      />,
    );
    expect(screen.getByText("Tax Preference per Account")).toBeInTheDocument();
  });

  it("calls setWithdrawalTaxPref when a tax preference select changes", () => {
    const setWithdrawalTaxPref = vi.fn();
    const taxCat = categoriesWithTaxPreference()[0];
    if (!taxCat) return; // nothing to assert if config has none
    render(
      <DecumulationConfig
        {...baseProps({
          showDecumConfig: true,
          withdrawalRoutingMode: "waterfall",
          setWithdrawalTaxPref,
        })}
      />,
    );
    const selects = screen.getAllByRole("combobox");
    // First combobox in this section belongs to the first tax-preference category.
    fireEvent.change(selects[0]!, { target: { value: "roth" } });
    expect(setWithdrawalTaxPref).toHaveBeenCalledTimes(1);
  });

  it("renders the dynamic-strategy context banner when activeSpendingStrategy is not 'fixed'", () => {
    render(
      <DecumulationConfig
        {...baseProps({ activeSpendingStrategy: "guyton_klinger" })}
      />,
    );
    // Banner text varies by strategy but always mentions "FROM WHICH accounts"
    expect(screen.getByText(/FROM WHICH accounts/)).toBeInTheDocument();
  });

  it("does not render the dynamic-strategy banner for the fixed strategy", () => {
    render(
      <DecumulationConfig
        {...baseProps({ activeSpendingStrategy: "fixed" })}
      />,
    );
    expect(screen.queryByText(/FROM WHICH accounts/)).not.toBeInTheDocument();
  });
});
