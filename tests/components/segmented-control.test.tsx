/**
 * Tests for SegmentedControl: each look reproduces the hand-built option
 * group it replaced class for class, and the group works from the keyboard.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import {
  SegmentedControl,
  segmentedClasses,
  type SegmentedLook,
} from "@/components/ui/segmented-control";

const STANDARD_ON = "bg-surface-primary text-primary font-medium shadow-sm";

// The strings the groups rendered before (group, option base, chosen, other).
const BEFORE: Record<SegmentedLook, [string, string, string, string]> = {
  bordered: [
    "border-default text-caption inline-flex shrink-0 overflow-hidden rounded-md border",
    "px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    "bg-blue-600 text-white",
    "bg-surface-primary text-muted hover:text-primary",
  ],
  "tray-caption": [
    "bg-surface-elevated flex rounded p-0.5",
    "text-caption rounded px-2 py-0.5 transition-colors",
    STANDARD_ON,
    "text-muted hover:text-secondary",
  ],
  "tray-fill": [
    "bg-surface-elevated flex rounded p-0.5",
    "flex-1 rounded px-2 py-1 text-xs transition-colors",
    STANDARD_ON,
    "text-muted hover:text-secondary",
  ],
  "tray-strong": [
    "bg-surface-elevated flex rounded p-0.5",
    "text-caption rounded px-1.5 py-0.5",
    "bg-surface-strong text-primary",
    "text-faint hover:text-primary",
  ],
  "tray-sunken": [
    "bg-surface-sunken flex w-fit items-center gap-1 rounded p-0.5",
    "rounded px-2.5 py-1 text-xs transition-colors",
    STANDARD_ON,
    "text-faint hover:text-muted",
  ],
  "tray-label": [
    "bg-surface-elevated flex gap-0.5 rounded-md p-0.5",
    "text-label rounded px-2 py-0.5 transition-colors",
    STANDARD_ON,
    "text-muted hover:text-secondary",
  ],
  pill: [
    "bg-surface-elevated flex gap-1 rounded-full p-0.5",
    "rounded-full px-3 py-1 text-xs transition-colors",
    "bg-blue-600 text-white",
    "text-muted hover:text-primary",
  ],
  "tray-lg": [
    "bg-surface-elevated flex gap-1 rounded-lg p-1",
    "rounded-md px-4 py-1.5 text-sm transition-colors",
    STANDARD_ON,
    "text-muted hover:text-primary",
  ],
};

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const;

function Group({ look }: { look?: SegmentedLook }) {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <SegmentedControl
      look={look}
      ariaLabel="Letters"
      value={value}
      onChange={setValue}
      options={OPTIONS}
    />
  );
}

describe("SegmentedControl", () => {
  it.each(Object.entries(BEFORE))(
    "look %s renders the hand-built group's classes",
    (look, [group, option, on, off]) => {
      render(<Group look={look as SegmentedLook} />);
      expect(screen.getByRole("radiogroup").className).toBe(group);
      const [chosen, other] = screen.getAllByRole("radio");
      expect(chosen!.className).toBe(`${option} ${on}`);
      expect(other!.className).toBe(`${option} ${off}`);
    },
  );

  it("is bordered when no look is given", () => {
    render(<Group />);
    expect(screen.getByRole("radiogroup").className).toBe(
      segmentedClasses("bordered", false).group,
    );
  });

  it("calls onChange only for another option, unless reselect is set", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl
        ariaLabel="x"
        value="a"
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      <SegmentedControl
        ariaLabel="x"
        value="a"
        onChange={onChange}
        options={OPTIONS}
        reselect
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("moves the choice and focus with the arrow keys, Home and End", () => {
    render(<Group look="tray-lg" />);
    const radio = (name: string) => screen.getByRole("radio", { name });
    fireEvent.keyDown(radio("Alpha"), { key: "ArrowRight" });
    expect(radio("Beta")).toHaveAttribute("aria-checked", "true");
    expect(radio("Beta")).toHaveFocus();
    fireEvent.keyDown(radio("Beta"), { key: "ArrowDown" });
    expect(radio("Gamma")).toHaveFocus();
    fireEvent.keyDown(radio("Gamma"), { key: "ArrowDown" });
    expect(radio("Alpha")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Alpha"), { key: "ArrowUp" });
    expect(radio("Gamma")).toHaveFocus();
    fireEvent.keyDown(radio("Gamma"), { key: "Home" });
    expect(radio("Alpha")).toHaveFocus();
    fireEvent.keyDown(radio("Alpha"), { key: "End" });
    expect(radio("Gamma")).toHaveAttribute("aria-checked", "true");
  });

  it("ignores the keys when disabled", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="x"
        value="a"
        onChange={onChange}
        options={OPTIONS}
        disabled
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Alpha" }), {
      key: "ArrowRight",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets Tab reach only the chosen option, or the first when none is", () => {
    const { rerender } = render(<Group />);
    expect(
      screen.getAllByRole("radio").map((r) => r.getAttribute("tabindex")),
    ).toEqual(["0", "-1", "-1"]);
    rerender(
      <SegmentedControl
        ariaLabel="x"
        value={7}
        onChange={vi.fn()}
        options={[
          { value: 1, label: "1" },
          { value: 2, label: "2" },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("radio").map((r) => r.getAttribute("tabindex")),
    ).toEqual(["0", "-1"]);
  });
});
