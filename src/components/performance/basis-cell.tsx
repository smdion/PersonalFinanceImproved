"use client";

/**
 * A Roth basis cell on the Performance table. Basis is per person, and one
 * row can cover an account two people hold, so each person gets their own
 * line (named when there's more than one), editable on its own. The edit
 * field is "<field>:<ownerPersonId>".
 */
import { useEffect, useRef } from "react";
import { formatCurrency } from "@/lib/utils/format";
import type { AccountRow } from "./types";

type Field = "contributionBasis" | "conversionBasis";

const basisEditField = (field: Field, ownerPersonId: number) =>
  `${field}:${ownerPersonId}`;

export function parseBasisEditField(
  value: string,
): { field: Field; ownerPersonId: number } | null {
  const [field, owner] = value.split(":");
  if (field !== "contributionBasis" && field !== "conversionBasis") return null;
  const ownerPersonId = Number(owner);
  return Number.isInteger(ownerPersonId) ? { field, ownerPersonId } : null;
}

export function BasisCell({
  row,
  field,
  editable,
  editingField,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
}: {
  row: AccountRow;
  field: Field;
  editable: boolean;
  /** The basis field being edited on this row, if any. */
  editingField: string | null;
  editValue: string;
  onStartEdit: (editField: string, current: number) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingField]);
  const owners = row.basisByOwner ?? [];
  const named = owners.length > 1;
  return (
    <td className="text-muted px-4 py-2 text-right whitespace-nowrap">
      {owners.map((o) => {
        const key = basisEditField(field, o.ownerPersonId);
        const value = o[field];
        return (
          <div key={o.ownerPersonId}>
            {named && (
              <span className="text-faint mr-1 text-xs">{o.ownerName}</span>
            )}
            {editingField === key ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={onSaveEdit}
                onKeyDown={onKeyDown}
                aria-label={`${o.ownerName ?? ""} ${field === "contributionBasis" ? "contribution" : "conversion"} basis`}
                className="bg-surface-primary w-24 rounded border border-blue-400 px-2 py-0.5 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            ) : editable ? (
              <button
                type="button"
                className={`rounded px-1 hover:bg-blue-50 ${o.recorded === false ? "text-faint" : ""}`}
                title={
                  o.recorded === false
                    ? "No basis recorded for this year — click to enter it"
                    : undefined
                }
                onClick={() => onStartEdit(key, value)}
              >
                {o.recorded === false ? "not recorded" : formatCurrency(value)}
              </button>
            ) : (
              <span className={o.recorded === false ? "text-faint" : ""}>
                {o.recorded === false ? "not recorded" : formatCurrency(value)}
              </span>
            )}
          </div>
        );
      })}
    </td>
  );
}
