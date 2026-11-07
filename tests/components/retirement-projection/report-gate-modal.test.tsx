/**
 * The full-report gate: the reason shows, Close, Escape and the backdrop
 * cancel, and only a stale Simulation offers to run it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportGateModal } from "@/components/retirement-projection/report/report-gate-modal";

describe("ReportGateModal", () => {
  it("offers to run a stale Simulation", () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <ReportGateModal
        failure="mc-not-fresh"
        onRunSimulation={onRun}
        isRunning={false}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Full report not ready");
    expect(dialog).toHaveTextContent("Run the simulation first");
    fireEvent.click(screen.getByRole("button", { name: "Run the simulation" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("only explains a reason it can't fix, and shows a run in progress", () => {
    const { rerender } = render(
      <ReportGateModal
        failure="simple-tax-mode"
        onRunSimulation={vi.fn()}
        isRunning={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "needs Advanced tax mode",
    );
    expect(
      screen.queryByRole("button", { name: "Run the simulation" }),
    ).toBeNull();
    rerender(
      <ReportGateModal
        failure="mc-not-fresh"
        onRunSimulation={vi.fn()}
        isRunning
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
  });

  it("is named by its title, and Escape or the backdrop cancels it", () => {
    const onCancel = vi.fn();
    render(
      <ReportGateModal
        failure="mc-not-fresh"
        onRunSimulation={vi.fn()}
        isRunning={false}
        onCancel={onCancel}
      />,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Full report not ready" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
