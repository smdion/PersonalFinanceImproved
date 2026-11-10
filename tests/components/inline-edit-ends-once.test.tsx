/**
 * InlineEdit ends an edit once: Enter then the input's blur saves once, and
 * Escape then the blur saves nothing. Both handlers run from one render, as
 * when the key removes the focused input and the browser blurs it before
 * React re-renders (whether a browser fires that blur is what only a real
 * browser shows; this pins what happens when it does).
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InlineEdit } from "@/components/ui/inline-edit";

function editing(onSave: (v: string) => void) {
  render(<InlineEdit value="100" onSave={onSave} ariaLabel="Amount" />);
  fireEvent.click(screen.getByRole("button"));
  const input = screen.getByRole("textbox", { name: "Amount" });
  fireEvent.change(input, { target: { value: "250" } });
  return input;
}

describe("InlineEdit ends an edit once", () => {
  it("Enter then the blur saves once", () => {
    const onSave = vi.fn();
    const input = editing(onSave);
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("250");
  });

  it("Escape then the blur saves nothing", () => {
    const onSave = vi.fn();
    const input = editing(onSave);
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a later edit saves again", () => {
    const onSave = vi.fn();
    const input = editing(onSave);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button"));
    const again = screen.getByRole("textbox", { name: "Amount" });
    fireEvent.change(again, { target: { value: "300" } });
    fireEvent.blur(again);
    expect(onSave.mock.calls).toEqual([["250"], ["300"]]);
  });
});
