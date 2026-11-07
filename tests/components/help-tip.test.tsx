import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HelpTip } from "@/components/ui/help-tip";
import { pressKey } from "./keyboard";

function mount() {
  render(
    <TooltipProvider>
      <HelpTip text="Deducted before taxes." />
    </TooltipProvider>,
  );
  return screen.getByRole("button", { name: "Deducted before taxes." });
}
const tip = () => screen.queryByRole("tooltip");

describe("HelpTip", () => {
  it("is a tab stop that still shows only its ?", () => {
    const trigger = mount();
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger.textContent).toBe("?");
  });

  it("keyboard focus shows the tip; blur hides it", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tip()).toHaveTextContent("Deducted before taxes.");
    act(() => trigger.blur());
    expect(tip()).toBeNull();
  });

  it("Escape hides the tip", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j toggles the tip, as a click does",
    (key) => {
      const trigger = mount();
      pressKey(trigger, key);
      expect(tip()).not.toBeNull();
      pressKey(trigger, key);
      expect(tip()).toBeNull();
    },
  );
});

describe("HelpTip inside another control", () => {
  it("isn't a tab stop of its own, and its click still toggles the tip", () => {
    render(
      <TooltipProvider>
        <button type="button">
          Section <HelpTip text="Inside a button." />
        </button>
      </TooltipProvider>,
    );
    const trigger = screen.getByLabelText("Inside a button.");
    expect(trigger).not.toHaveAttribute("tabindex");
    expect(trigger).not.toHaveAttribute("role");
    fireEvent.click(trigger);
    expect(tip()).not.toBeNull();
  });
});
