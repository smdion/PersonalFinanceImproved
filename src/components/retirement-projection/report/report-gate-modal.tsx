"use client";

/** Shown when "Print Full Report" is clicked but checkReportGate fails —
 *  explains why and offers a one-click fix where one exists (running the
 *  simulation). Modal keeps it out of a printed page. */
import type { ReportGateFailure } from "@/lib/pure/advice/report/mc-freshness";
import { reportGateFailureMessage } from "@/lib/pure/advice/report/mc-freshness";
import { Modal } from "@/components/ui/modal";

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
    <Modal
      onClose={onCancel}
      role="alertdialog"
      label="Full report not ready"
      className="bg-surface-primary mx-4 w-full max-w-md rounded-lg border p-5 shadow-xl"
    >
      <h3 className="text-primary mb-1 text-sm font-semibold">
        Full report not ready
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
    </Modal>
  );
}
