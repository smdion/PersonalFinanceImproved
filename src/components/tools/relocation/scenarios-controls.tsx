"use client";

/** Scenario save/load controls + save dialog for the Relocation calculator.
 *  Extracted from tools/page.tsx during the v0.5.2 file-split refactor.
 *  The parent owns the tRPC queries/mutations; this component only renders
 *  the UI and invokes prop callbacks.
 */

import type { RelocationScenarioParams } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";

type ScenarioListItem = {
  id: number;
  name: string;
  params: RelocationScenarioParams;
};

type Props = {
  scenarios: ScenarioListItem[];
  selectedScenarioId: number | null;
  setSelectedScenarioId: (id: number | null) => void;
  loadScenario: (params: RelocationScenarioParams) => void;

  saveIsPending: boolean;
  deleteIsPending: boolean;

  /** Save-in-place: create new (when no selection) or update the selected scenario. */
  onSaveClick: () => void;
  /** Open the dialog to save-as a new scenario. */
  onSaveAsClick: () => void;
  /** Delete the currently selected scenario (with confirmation). */
  onDeleteClick: () => void;

  showSaveDialog: boolean;
  setShowSaveDialog: (show: boolean) => void;
  saveScenarioName: string;
  setSaveScenarioName: (name: string) => void;
  /** Submit the save dialog — invoked by Enter key or Save button. */
  onSaveDialogSubmit: () => void;
};

export function RelocationScenariosControls({
  scenarios,
  selectedScenarioId,
  setSelectedScenarioId,
  loadScenario,
  saveIsPending,
  deleteIsPending,
  onSaveClick,
  onSaveAsClick,
  onDeleteClick,
  showSaveDialog,
  setShowSaveDialog,
  saveScenarioName,
  setSaveScenarioName,
  onSaveDialogSubmit,
}: Props) {
  return (
    <>
      {/* Scenario save/load controls */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <select
          className="border rounded px-2 py-1 text-sm min-w-[180px]"
          value={selectedScenarioId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            setSelectedScenarioId(id);
            if (id) {
              const scenario = scenarios.find((s) => s.id === id);
              if (scenario) loadScenario(scenario.params);
            }
          }}
        >
          <option value="">Unsaved</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={saveIsPending} onClick={onSaveClick}>
          {selectedScenarioId ? "Update" : "Save"}
        </Button>
        {selectedScenarioId && (
          <>
            <button
              className="px-3 py-1 bg-surface-strong text-secondary rounded text-sm hover:bg-surface-strong"
              onClick={onSaveAsClick}
            >
              Save As
            </button>
            <button
              className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 disabled:opacity-50"
              disabled={deleteIsPending}
              onClick={onDeleteClick}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {/* Save dialog */}
      {showSaveDialog && (
        <div className="mb-4 flex items-center gap-2 p-3 border rounded bg-surface-sunken text-sm">
          <label className="text-muted">Name:</label>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm flex-1"
            placeholder="Scenario name"
            value={saveScenarioName}
            onChange={(e) => setSaveScenarioName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveScenarioName.trim()) {
                onSaveDialogSubmit();
              }
              if (e.key === "Escape") setShowSaveDialog(false);
            }}
          />
          <Button
            size="sm"
            disabled={!saveScenarioName.trim() || saveIsPending}
            onClick={onSaveDialogSubmit}
          >
            {saveIsPending ? "Saving..." : "Save"}
          </Button>
          <button
            className="px-2 py-1 text-muted hover:text-secondary text-sm"
            onClick={() => setShowSaveDialog(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
