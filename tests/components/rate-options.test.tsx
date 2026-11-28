/** The shared rate-select entries: a saved rate always shows as itself (the Assumptions band's
 *  Bracket Ceiling picker renders `CeilingOptions` without incomes). */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CeilingOptions } from "@/components/retirement/sections/rate-options";

function renderCeiling(saved: number) {
  render(
    <select aria-label="ceiling" value={String(saved)} onChange={() => {}}>
      <CeilingOptions saved={saved} />
    </select>,
  );
  const select = screen.getByLabelText("ceiling") as HTMLSelectElement;
  return {
    value: select.value,
    shown: select.options[select.selectedIndex]!.textContent,
    labels: [...select.options].map((o) => o.textContent),
  };
}

describe("CeilingOptions", () => {
  it("lists the five ceilings, plain, when the saved one is listed", () => {
    expect(renderCeiling(0.22)).toEqual({
      value: "0.22",
      shown: "22%",
      labels: ["10%", "12%", "22%", "24%", "32%"],
    });
  });

  it.each([
    [0, "0%"],
    [0.35, "35%"],
    [0.37, "37%"],
  ])(
    "a saved %s outside the list gets its own entry (%s), selected",
    (saved, label) => {
      const r = renderCeiling(saved);
      expect(r.value).toBe(String(saved));
      expect(r.shown).toBe(label);
      expect(r.labels).toHaveLength(6);
    },
  );
});
