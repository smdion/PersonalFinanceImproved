/**
 * The IRMAA surcharge choice shows only with IRMAA awareness on (without it
 * there's no surcharge to place) and saves through the settings patch.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HealthcareSection } from "@/components/retirement/sections/healthcare";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/retirement/sections/settings-patch", () => ({
  buildSettingsPatch: (_s: unknown, patch: unknown) => patch,
}));

const renderWith = (settings: Record<string, unknown>) => {
  const mutate = vi.fn();
  render(
    <HealthcareSection
      settings={settings as never}
      upsertSettings={{ mutate } as never}
      isEditable={(() => true) as never}
    />,
  );
  return mutate;
};

describe("HealthcareSection — IRMAA surcharge", () => {
  it("hidden while IRMAA awareness is off", () => {
    renderWith({ enableIrmaaAwareness: false });
    expect(screen.queryByText("IRMAA surcharge")).toBeNull();
  });

  it("in the budget by default; a click puts it on top", () => {
    const mutate = renderWith({ enableIrmaaAwareness: true });
    fireEvent.click(screen.getByText("In my budget"));
    expect(mutate).toHaveBeenCalledWith({ irmaaOnTopOfBudget: true });
  });

  it("shows on top when set", () => {
    renderWith({ enableIrmaaAwareness: true, irmaaOnTopOfBudget: true });
    expect(screen.getByText("On top of my budget")).toBeInTheDocument();
  });
});
