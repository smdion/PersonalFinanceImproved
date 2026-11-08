/**
 * A label wired to its control: clicking the label's text reaches the
 * control a screen reader names with it. happy-dom forwards a label's click
 * to its control but doesn't move focus (a browser does both), so this
 * checks the forwarded click and the label's `control`.
 */
import { expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

export function expectLabelReachesControl(text: string): void {
  const label = screen.getByText(text).closest("label");
  expect(label, `no <label> around "${text}"`).not.toBeNull();
  const control = screen.getByLabelText(text);
  const onClick = vi.fn();
  control.addEventListener("click", onClick);
  fireEvent.click(label!);
  expect(label!.control).toBe(control);
  expect(onClick).toHaveBeenCalledTimes(1);
}
