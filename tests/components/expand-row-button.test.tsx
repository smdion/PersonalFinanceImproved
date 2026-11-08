import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpandRowButton } from "@/components/ui/expand-row-button";
import { pressKey } from "./keyboard";

function Row({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <table>
      <tbody>
        <tr onClick={onToggle}>
          <td>
            <ExpandRowButton expanded={expanded} label="Housing" />
            Housing
          </td>
          <td>$1,200.00</td>
        </tr>
      </tbody>
    </table>
  );
}

describe("ExpandRowButton", () => {
  it("is a button named by its row, with the expanded state", () => {
    const { rerender } = render(<Row expanded={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Housing" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    rerender(<Row expanded onToggle={() => {}} />);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j toggles the row once, as a click does",
    (key) => {
      const onToggle = vi.fn();
      render(<Row expanded={false} onToggle={onToggle} />);
      pressKey(screen.getByRole("button", { name: "Housing" }), key);
      expect(onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it("a click on the button toggles the row once; a click on a cell still does", () => {
    const onToggle = vi.fn();
    render(<Row expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Housing" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("$1,200.00"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("draws the text triangle a row asks for, hidden from screen readers", () => {
    render(<ExpandRowButton expanded label="Snapshot" glyph="triangle" />);
    const button = screen.getByRole("button", { name: "Snapshot" });
    expect(button.querySelector("svg")).toBeNull();
    const glyph = button.querySelector("span")!;
    expect(glyph).toHaveTextContent("\u25b6");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("rotate-90");
  });
});
