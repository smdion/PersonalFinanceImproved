/** The Withdrawal Routing select's options: a saved mode this version
 *  doesn't know shows as itself, disabled; a known one adds nothing. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoutingModeOptions } from "@/components/retirement/sections/routing-mode-options";

function optionsFor(stored: string) {
  render(
    <select aria-label="routing" value={stored} onChange={() => {}}>
      <RoutingModeOptions stored={stored} />
    </select>,
  );
  return screen.getAllByRole("option");
}

describe("RoutingModeOptions", () => {
  it("shows an unknown saved mode as a disabled Unknown option", () => {
    const options = optionsFor("glide_path");
    expect(options).toHaveLength(4);
    const unknown = screen.getByRole("option", {
      name: "Unknown (glide_path)",
    });
    expect(unknown).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveValue("glide_path");
  });

  it("adds no option for a known mode", () => {
    const options = optionsFor("waterfall");
    expect(options.map((o) => o.textContent)).toEqual([
      "Bracket Filling (default)",
      "Waterfall",
      "Percentage",
    ]);
  });
});
