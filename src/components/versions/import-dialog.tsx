"use client";

/** The confirmation before a backup file replaces the household's data. */

import { ReplacesNote } from "@/components/versions/replaces-note";
import { DataLossWarning } from "@/components/versions/restore-notices";

type ImportDialogProps = {
  showImportConfirm: boolean;
  importFile: File | null;
  importDataLoss: { tableName: string; currentRows: number }[] | undefined;
  importConfirmText: string;
  setImportConfirmText: (text: string) => void;
  importError: string | null;
  handleImport: () => Promise<void>;
  importLoading: boolean;
  setShowImportConfirm: (show: boolean) => void;
  setImportFile: (file: null) => void;
  setImportError: (error: null) => void;
};

export function ImportDialog({
  showImportConfirm,
  importFile,
  importDataLoss,
  importConfirmText,
  setImportConfirmText,
  importError,
  handleImport,
  importLoading,
  setShowImportConfirm,
  setImportFile,
  setImportError,
}: ImportDialogProps) {
  return (
    <>
      {showImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
            <h3 className="text-primary mb-2 text-lg font-semibold">
              Import Backup
            </h3>
            <ReplacesNote className="mb-1">with the contents of:</ReplacesNote>
            <p className="text-primary mb-3 font-mono text-sm font-medium">
              {importFile?.name}
            </p>

            <DataLossWarning tables={importDataLoss} />

            <div className="mb-4">
              <label className="text-secondary mb-1 block text-sm font-medium">
                Type IMPORT to confirm:
              </label>
              <input
                type="text"
                value={importConfirmText}
                onChange={(e) => setImportConfirmText(e.target.value)}
                placeholder="IMPORT"
                className="border-strong bg-surface-primary text-primary w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            {importError && (
              <p className="mb-3 text-xs text-red-600">{importError}</p>
            )}

            <div className="border-subtle flex gap-2 border-t pt-3">
              <button
                onClick={handleImport}
                disabled={importConfirmText !== "IMPORT" || importLoading}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {importLoading ? "Importing..." : "Import"}
              </button>
              <button
                onClick={() => {
                  setShowImportConfirm(false);
                  setImportFile(null);
                  setImportConfirmText("");
                  setImportError(null);
                }}
                className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
