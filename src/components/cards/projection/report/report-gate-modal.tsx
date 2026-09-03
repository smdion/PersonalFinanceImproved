"use client";

/** Shown when "Print Advisor Report" is clicked but checkReportGate fails —
 *  explains why and offers a one-click fix where one exists (running the
 *  simulation). Modeled on push-preview-modal.tsx's shell. print:hidden so
 *  it can never itself end up in a printed page. */
import type { ReportGateFailure } from "@/lib/pure/report/mc-freshness";
import { reportGateFailureMessage } from "@/lib/pure/report/mc-freshness";

export function ReportGateModal({
  failure,
  onRunSimulation,
  isRunning,
  onCancel,
}: {
  failure: ReportGateFailure;
  onRunSimulation: () => void;
  isRunning: boolean;
  onCancel: () => void;
}) {
  const canRunSimulation = failure === "mc-not-fresh";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-surface-primary mx-4 w-full max-w-md rounded-lg border p-5 shadow-xl"
      >
        <h3 className="text-primary mb-1 text-sm font-semibold">
          Advisor report not ready
        </h3>
        <p className="text-muted mb-4 text-xs">
          {reportGateFailureMessage(failure)}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-secondary hover:text-primary px-3 py-1.5 text-xs"
          >
            Close
          </button>
          {canRunSimulation && (
            <button
              type="button"
              onClick={onRunSimulation}
              disabled={isRunning}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isRunning ? "Running…" : "Run the simulation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
