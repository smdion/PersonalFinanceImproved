/**
 * Tests for the Tabs primitive: each look reproduces the hand-built strip it
 * replaced class for class, and the strip works from the keyboard.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import {
  Tabs,
  tabPanelProps,
  tabsClasses,
  type TabsLook,
} from "@/components/ui/tabs";

// The strings the hand-built strips rendered (list, tab base, chosen, other).
const BEFORE: Record<TabsLook, [string, string, string, string]> = {
  "underline-xs": [
    "flex gap-1 overflow-x-auto",
    "border-b-2 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors",
    "border-blue-600 text-blue-600",
    "text-muted hover:text-secondary border-transparent",
  ],
  "underline-nav": [
    "flex gap-1 overflow-x-auto",
    "border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
    "border-blue-600 text-blue-600",
    "text-muted hover:text-secondary hover:border-strong border-transparent",
  ],
  "underline-lg": [
    "border-subtle flex border-b",
    "-mb-px border-b-2 px-5 py-2.5 text-sm font-medium transition-colors",
    "border-blue-600 text-blue-600",
    "text-muted hover:text-primary border-transparent",
  ],
  "underline-sm": [
    "flex",
    "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
    "border-blue-600 text-blue-600",
    "text-muted hover:text-primary border-transparent",
  ],
  "underline-compact": [
    "flex gap-1",
    "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
    "border-blue-600 text-blue-600",
    "text-muted hover:text-secondary border-transparent",
  ],
  "underline-neutral": [
    "flex gap-1",
    "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
    "border-primary text-primary",
    "text-muted hover:text-primary border-transparent",
  ],
  folder: [
    "flex gap-1 border-b px-3 pt-2",
    "rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors",
    "bg-surface-primary text-primary border border-b-0",
    "text-muted hover:text-secondary",
  ],
  tray: [
    "bg-surface-elevated flex rounded-md p-0.5",
    "text-label rounded px-2.5 py-1.5 transition-colors",
    "bg-surface-primary text-primary shadow-sm",
    "text-muted hover:text-secondary",
  ],
  chip: [
    "flex gap-1",
    "rounded-full px-3 py-1 text-sm transition-colors",
    "bg-blue-600 text-white",
    "bg-surface-elevated text-muted hover:bg-surface-strong",
  ],
};

const TABS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const;

function Strip({ look = "tray" }: { look?: TabsLook }) {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <>
      <Tabs
        look={look}
        id="t"
        ariaLabel="Letters"
        value={value}
        onChange={setValue}
        tabs={TABS}
      />
      <div {...tabPanelProps("t", value)}>panel {value}</div>
    </>
  );
}

describe("Tabs", () => {
  it.each(Object.entries(BEFORE))(
    "look %s renders the hand-built strip's classes",
    (look, [list, tab, on, off]) => {
      render(<Strip look={look as TabsLook} />);
      expect(screen.getByRole("tablist").className).toBe(list);
      const [chosen, other] = screen.getAllByRole("tab");
      expect(chosen!.className).toBe(`${tab} ${on}`);
      expect(other!.className).toBe(`${tab} ${off}`);
    },
  );

  it("names every look once, with nothing extra", () => {
    for (const [look, [list, tab, , off]] of Object.entries(BEFORE)) {
      expect(tabsClasses(look as TabsLook, false)).toEqual({
        list,
        tab: `${tab} ${off}`,
      });
    }
  });

  it("marks the chosen tab and wires it to the panel", () => {
    render(<Strip />);
    const chosen = screen.getByRole("tab", { name: "Alpha" });
    expect(chosen).toHaveAttribute("aria-selected", "true");
    expect(chosen).toHaveAttribute("aria-controls", "t-panel");
    expect(screen.getByRole("tab", { name: "Beta" })).not.toHaveAttribute(
      "aria-controls",
    );
    expect(screen.getByRole("tabpanel", { name: "Alpha" })).toHaveTextContent(
      "panel a",
    );
  });

  it("chooses a tab on click", () => {
    render(<Strip />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves the choice and focus with the arrow keys, Home and End", () => {
    render(<Strip />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowRight" });
    expect(tab("Beta")).toHaveAttribute("aria-selected", "true");
    expect(tab("Beta")).toHaveFocus();
    fireEvent.keyDown(tab("Beta"), { key: "End" });
    expect(tab("Gamma")).toHaveFocus();
    fireEvent.keyDown(tab("Gamma"), { key: "ArrowRight" });
    expect(tab("Alpha")).toHaveFocus();
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowLeft" });
    expect(tab("Gamma")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Gamma"), { key: "Home" });
    expect(tab("Alpha")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
  });

  it("leaves up and down alone in a horizontal strip", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        look="chip"
        value={1}
        onChange={onChange}
        tabs={[
          { value: 1, label: "1" },
          { value: 2, label: "2" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "1" }), {
      key: "ArrowDown",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets Tab reach only the chosen tab, or the first when none is", () => {
    const { rerender } = render(<Strip />);
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex")),
    ).toEqual(["0", "-1", "-1"]);
    rerender(
      <Tabs
        look="chip"
        value={9}
        onChange={vi.fn()}
        tabs={[
          { value: 1, label: "1" },
          { value: 2, label: "2" },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex")),
    ).toEqual(["0", "-1"]);
  });
});
