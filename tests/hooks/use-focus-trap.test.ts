/**
 * useFocusTrap keeps Tab and Shift+Tab inside its container: from the last
 * or first control, and from the container itself (focused on open).
 */
import { createElement as h } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

afterEach(() => {
  cleanup();
});

function Trap() {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return h(
    "div",
    { ref, tabIndex: -1, "data-testid": "trap" },
    h("button", { type: "button" }, "First"),
    h("button", { type: "button" }, "Last"),
  );
}

describe("useFocusTrap", () => {
  it("wraps from the last control to the first and back", () => {
    render(h(Trap));
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps Shift+Tab from the container inside, on the last control", () => {
    render(h(Trap));
    const trap = screen.getByTestId("trap");
    trap.focus();
    fireEvent.keyDown(trap, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Last" }),
    );
  });

  it("moves Tab from the container to the first control", () => {
    render(h(Trap));
    const trap = screen.getByTestId("trap");
    trap.focus();
    fireEvent.keyDown(trap, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First" }),
    );
  });
});
