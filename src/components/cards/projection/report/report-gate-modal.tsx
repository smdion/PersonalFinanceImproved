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
        className="bg-surface-primary rounded-lg shadow-xl border p-5 max-w-md w-full mx-4"
      >
        <h3 className="text-sm font-semibold text-primary mb-1">
          Advisor report not ready
        </h3>
        <p className="text-xs text-muted mb-4">
          {reportGateFailureMessage(failure)}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-secondary hover:text-primary"
          >
            Close
          </button>
          {canRunSimulation && (
            <button
              type="button"
              onClick={onRunSimulation}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isRunning ? "Running…" : "Run the simulation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
