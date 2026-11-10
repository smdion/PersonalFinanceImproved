import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileListRow } from "@/components/profiles/profile-sidebar";
import { pressKey } from "./keyboard";

function mount(meta?: React.ReactNode) {
  const handlers = { onSelect: vi.fn(), onActivate: vi.fn(), onClone: vi.fn() };
  render(
    <ProfileListRow
      name="Early retirement"
      isSelected={false}
      isActive={false}
      meta={meta}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ProfileListRow keys", () => {
  it.each([["Enter" as const], [" " as const]])(
    "%j on the row selects it",
    (key) => {
      const { onSelect } = mount();
      // The row is the first button; its actions sit inside it.
      pressKey(screen.getAllByRole("button")[0]!, key);
      expect(onSelect).toHaveBeenCalledTimes(1);
    },
  );

  it.each([["Enter" as const], [" " as const]])(
    "%j on a row action acts on that button, not the row",
    (key) => {
      const { onSelect, onActivate, onClone } = mount();
      pressKey(screen.getByRole("button", { name: "activate" }), key);
      pressKey(screen.getByRole("button", { name: "clone" }), key);
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onClone).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it("a select in the meta slot (the tax-law year) keeps its keys", () => {
    const { onSelect } = mount(
      <span role="presentation" onClick={(e) => e.stopPropagation()}>
        <select aria-label="Tax law" defaultValue="">
          <option value="">Latest</option>
          <option value="2026">2026</option>
        </select>
      </span>,
    );
    const select = screen.getByRole("combobox", { name: "Tax law" });
    expect(fireEvent.keyDown(select, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(select, { key: "Enter" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
