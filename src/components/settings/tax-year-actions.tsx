"use client";

/** The tax-data editors' empty-year panel (copy a year forward, then add it)
 *  and their delete-year confirmation bar. */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type AddYearPanelProps = {
  message: ReactNode;
  admin: boolean;
  year: number;
  years: number[];
  copyFrom: number | null;
  onCopyFromChange: (year: number | null) => void;
  /** A first option that copies nothing; without it a year is required. */
  noneLabel?: string;
  onAdd: () => void;
};

export function AddYearPanel({
  message,
  admin,
  year,
  years,
  copyFrom,
  onCopyFromChange,
  noneLabel,
  onAdd,
}: AddYearPanelProps) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-center">
      <p className="text-muted mb-3 text-sm">{message}</p>
      {admin && (
        <div className="flex items-center justify-center gap-3">
          {years.length > 0 && (
            <label className="text-secondary text-sm">
              Copy from:
              <select
                value={copyFrom ?? ""}
                onChange={(e) =>
                  onCopyFromChange(
                    e.target.value ? parseInt(e.target.value) : null,
                  )
                }
                className="ml-2 rounded border px-2 py-1 text-sm"
              >
                {noneLabel !== undefined && (
                  <option value="">{noneLabel}</option>
                )}
                {years.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button size="sm" onClick={onAdd} className="!font-normal">
            Add {year}
          </Button>
        </div>
      )}
    </div>
  );
}

type DeleteYearConfirmProps = {
  message: ReactNode;
  onDelete: () => void;
  onCancel: () => void;
};

export function DeleteYearConfirm({
  message,
  onDelete,
  onCancel,
}: DeleteYearConfirmProps) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
      <span className="text-sm text-red-800">{message}</span>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          onClick={onDelete}
          className="!font-normal"
        >
          Delete
        </Button>
        <button
          onClick={onCancel}
          className="text-muted hover:text-primary px-3 py-1 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
