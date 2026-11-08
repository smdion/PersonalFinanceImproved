/**
 * Popover: a click outside closes it and is swallowed, so nothing under the
 * catcher sees it; a click in the panel doesn't close it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Popover } from "@/components/ui/popover";

describe("Popover", () => {
  it("closes on an outside click without passing it on", () => {
    const onClose = vi.fn();
    const underneath = vi.fn();
    render(
      <div onClick={underneath}>
        <Popover onClose={onClose} layer="card" className="absolute">
          <button type="button">Set Fixed Target</button>
        </Popover>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set Fixed Target" }));
    expect(onClose).not.toHaveBeenCalled();
    underneath.mockClear();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
  });

  it("puts the catcher under the panel, on the layer asked for", () => {
    render(
      <Popover onClose={() => {}} layer="page" className="fixed w-56">
        <span>Since Inception</span>
      </Popover>,
    );
    const catcher = screen.getByRole("presentation");
    expect(catcher).toHaveClass("fixed", "inset-0", "z-40");
    expect(screen.getByText("Since Inception").parentElement).toHaveClass(
      "fixed",
      "w-56",
      "z-50",
    );
  });
});
