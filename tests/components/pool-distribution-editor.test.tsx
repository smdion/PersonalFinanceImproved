import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PoolDistributionEditor,
  type FundAllocation,
} from "@/components/savings/pool-distribution-editor";

// First direct coverage for this component. Written alongside its
// migration onto useInlineNumberEdit (Phase 3 item 3d) — the 3 fields
// (pool $, per-fund %, per-fund $) now share one editingField state
// machine instead of 3 near-identical hand-rolled commit handlers, so
// this locks in that only the field actually being edited responds to
// input, and the other two remain read-only buttons.

const funds: FundAllocation[] = [
  {
    goalId: 1,
    name: "Emergency Fund",
    defaultAmount: 300,
    amount: 300,
    colorIndex: 0,
  },
  {
    goalId: 2,
    name: "Vacation",
    defaultAmount: 200,
    amount: 200,
    colorIndex: 1,
  },
];

describe("PoolDistributionEditor", () => {
  it("commits an edited fund dollar amount on blur", () => {
    const onChange = vi.fn();
    render(
      <PoolDistributionEditor pool={500} funds={funds} onChange={onChange} />,
    );

    fireEvent.click(screen.getByText("$300.00"));
    const input = screen.getByDisplayValue("300");
    fireEvent.change(input, { target: { value: "350" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith([
      { ...funds[0], amount: 350 },
      funds[1],
    ]);
  });

  it("commits an edited fund percent, converting to a rounded dollar amount", () => {
    const onChange = vi.fn();
    render(
      <PoolDistributionEditor pool={500} funds={funds} onChange={onChange} />,
    );

    // Emergency Fund is 300/500 = 60.0%
    fireEvent.click(screen.getByText("60.0%"));
    const input = screen.getByDisplayValue("60.0");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith([
      { ...funds[0], amount: 250 },
      funds[1],
    ]);
  });

  it("ignores an out-of-range percent commit (>100)", () => {
    const onChange = vi.fn();
    render(
      <PoolDistributionEditor pool={500} funds={funds} onChange={onChange} />,
    );

    fireEvent.click(screen.getByText("60.0%"));
    const input = screen.getByDisplayValue("60.0");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape cancels without committing", () => {
    const onChange = vi.fn();
    render(
      <PoolDistributionEditor pool={500} funds={funds} onChange={onChange} />,
    );

    fireEvent.click(screen.getByText("$300.00"));
    const input = screen.getByDisplayValue("300");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("$300.00")).toBeInTheDocument();
  });

  it("commits an edited pool amount when poolEditable, via onPoolChange", () => {
    const onPoolChange = vi.fn();
    render(
      <PoolDistributionEditor
        pool={500}
        funds={funds}
        onChange={vi.fn()}
        onPoolChange={onPoolChange}
        poolEditable
      />,
    );

    fireEvent.click(screen.getByText("$500.00/mo"));
    const input = screen.getByDisplayValue("500");
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.blur(input);

    expect(onPoolChange).toHaveBeenCalledWith(600);
  });

  it("pool amount is not clickable/editable when poolEditable is false", () => {
    render(
      <PoolDistributionEditor pool={500} funds={funds} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("$500.00/mo"));
    expect(screen.queryByDisplayValue("500")).not.toBeInTheDocument();
  });

  it("only one field edits at a time — starting a fund edit doesn't affect the pool field", () => {
    const onChange = vi.fn();
    render(
      <PoolDistributionEditor
        pool={500}
        funds={funds}
        onChange={onChange}
        onPoolChange={vi.fn()}
        poolEditable
      />,
    );

    fireEvent.click(screen.getByText("$300.00"));
    // Pool button should still be a plain button, not an input.
    expect(screen.getByText("$500.00/mo")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("500")).not.toBeInTheDocument();
  });
});
