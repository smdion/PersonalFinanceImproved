/**
 * Tests for the shared Toggle switch primitive.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "@/components/ui/toggle";

describe("Toggle", () => {
  it("renders as a switch role reflecting the checked state", () => {
    render(<Toggle isChecked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("reflects aria-checked=true when isChecked", () => {
    render(<Toggle isChecked onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the inverted value when clicked (off -> on)", () => {
    const onChange = vi.fn();
    render(<Toggle isChecked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with the inverted value when clicked (on -> off)", () => {
    const onChange = vi.fn();
    render(<Toggle isChecked onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("renders a label when provided", () => {
    render(<Toggle isChecked={false} onChange={vi.fn()} label="Auto-sync" />);
    expect(screen.getByText("Auto-sync")).toBeInTheDocument();
  });

  it("does not render label text when omitted", () => {
    render(<Toggle isChecked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch").textContent).toBe("");
  });

  it("uses ariaLabel as the accessible name without rendering visible text (settings-row usage)", () => {
    render(
      <Toggle
        isChecked={false}
        onChange={vi.fn()}
        ariaLabel="Auto-load simulation"
      />,
    );
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("aria-label", "Auto-load simulation");
    expect(el.textContent).toBe("");
  });

  it("sets the title attribute when provided", () => {
    render(
      <Toggle isChecked={false} onChange={vi.fn()} title="Enable feature" />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute(
      "title",
      "Enable feature",
    );
  });

  it("stops event propagation on click (so it can be nested in clickable rows)", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <Toggle isChecked={false} onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(rowClick).not.toHaveBeenCalled();
  });
});
