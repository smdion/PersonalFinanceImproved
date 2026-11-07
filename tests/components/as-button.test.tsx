import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { asButton } from "@/components/ui/as-button";
import { pressKey } from "./keyboard";

describe("asButton", () => {
  it("makes an element a focusable button, with aria-expanded when given", () => {
    render(
      <>
        <span {...asButton(() => {})}>Plain</span>
        <div {...asButton(() => {}, true)}>Open</div>
      </>,
    );
    const plain = screen.getByRole("button", { name: "Plain" });
    expect(plain).toHaveAttribute("tabindex", "0");
    expect(plain).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j presses it once, as a click does",
    (key) => {
      const onPress = vi.fn();
      render(<span {...asButton(onPress)}>API</span>);
      const el = screen.getByRole("button", { name: "API" });
      pressKey(el, key);
      expect(onPress).toHaveBeenCalledTimes(1);
      fireEvent.click(el);
      expect(onPress).toHaveBeenCalledTimes(2);
    },
  );

  it("any other key does nothing, and keeps its default", () => {
    const onPress = vi.fn();
    render(<span {...asButton(onPress)}>API</span>);
    const notPrevented = fireEvent.keyDown(screen.getByRole("button"), {
      key: "Tab",
    });
    expect(notPrevented).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
  });
});
