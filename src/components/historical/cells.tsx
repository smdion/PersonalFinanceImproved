"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { Tooltip } from "@/components/ui/tooltip";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HIItem = {
  id: number;
  year: number;
  description: string;
  cost: number;
  note: string | null;
};
export type OAItem = { name: string; value: number; note: string | null };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STICKY_COL_W = 80; // px per sticky-left column

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function changeColor(value: number | null): string {
  if (value === null) return "text-faint";
  return value >= 0 ? "text-green-600" : "text-red-600";
}

// ---------------------------------------------------------------------------
// Note Components
// ---------------------------------------------------------------------------

export function NoteIndicator({ note }: { note: string }) {
  return (
    <span className="group/note relative ml-0.5 inline-block">
      <span className="inline-block h-0 w-0 cursor-help border-b-[5px] border-l-[5px] border-b-transparent border-l-amber-400" />
      <span className="text-caption absolute bottom-full left-0 z-50 mb-1 hidden max-w-[200px] rounded bg-slate-900 px-2 py-1 whitespace-normal text-slate-100 shadow-lg group-hover/note:block">
        {note}
      </span>
    </span>
  );
}

export function NoteableValue({
  children,
  year,
  field,
  notes,
  onUpsertNote,
  isCurrent,
}: {
  children: React.ReactNode;
  year: number;
  field: string;
  notes: Record<string, string>;
  onUpsertNote: (year: number, field: string, note: string) => void;
  isCurrent: boolean;
}) {
  const noteKey = `${year}:${field}`;
  const existingNote = notes[noteKey];

  return (
    <span className="group/cell relative inline-flex items-center gap-0.5">
      {children}
      {existingNote && <NoteIndicator note={existingNote} />}
      {!isCurrent && (
        <NoteButton
          year={year}
          field={field}
          existingNote={existingNote}
          onUpsertNote={onUpsertNote}
        />
      )}
    </span>
  );
}

export function NoteButton({
  year,
  field,
  existingNote,
  onUpsertNote,
}: {
  year: number;
  field: string;
  existingNote?: string;
  onUpsertNote: (year: number, field: string, note: string) => void;
}) {
  const {
    editingKey: editing,
    editValue: value,
    setEditValue: setValue,
    startEdit,
    commit,
    cancel,
  } = useInlineNumberEdit<true>({
    allowBlankCommit: true,
    onCommit: (_key, draft) => onUpsertNote(year, field, draft),
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const open = () => startEdit(true, existingNote ?? "");

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <span
        className="bg-surface-primary border-strong absolute top-full right-0 z-[9999] mt-1 rounded-lg border p-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Shift+Enter inserts a newline instead of committing — the
            // shared hook's handleKeyDown doesn't distinguish the two, so
            // this field wires commit/cancel directly instead of using it.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") cancel();
          }}
          className="h-14 w-48 resize-none rounded border p-1.5 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none"
          placeholder="Add note..."
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button
            onClick={cancel}
            className="text-caption text-faint hover:text-muted"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="text-caption font-medium text-blue-600 hover:text-blue-800"
          >
            Save
          </button>
        </div>
      </span>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      className="text-micro text-faint ml-0.5 hidden group-hover/cell:inline-block hover:text-amber-500"
      title={existingNote ? "Edit note" : "Add note"}
    >
      {existingNote ? "\u270E" : "\u2710"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Table Cell Components
// ---------------------------------------------------------------------------

export function ColHeader({
  children,
  border,
}: {
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <th
      className={`text-muted px-1.5 py-1.5 text-right font-medium ${
        border ? "border-l" : ""
      }`}
    >
      {children}
    </th>
  );
}

export function StickyLeftHeader({
  children,
  offset,
  borderRight,
}: {
  children: React.ReactNode;
  offset: number;
  borderRight?: boolean;
}) {
  return (
    <th
      className={`bg-surface-primary text-muted sticky z-20 px-1.5 py-1.5 text-right font-medium ${borderRight ? "border-strong border-r" : ""}`}
      style={{ left: offset * STICKY_COL_W }}
    >
      {children}
    </th>
  );
}

export function StickyLeftCell({
  children,
  offset,
  bold,
  borderRight,
  className: extraClass,
}: {
  children: React.ReactNode;
  offset: number;
  bold?: boolean;
  borderRight?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`bg-surface-primary sticky z-10 px-1.5 py-1.5 text-right ${
        bold ? "font-semibold" : ""
      } ${borderRight ? "border-strong border-r" : ""} ${extraClass ?? ""}`}
      style={{ left: offset * STICKY_COL_W }}
    >
      {children}
    </td>
  );
}

export function NumCell({
  value,
  bold,
  border,
  red,
}: {
  value: number | null;
  bold?: boolean;
  border?: boolean;
  red?: boolean;
}) {
  return (
    <td
      className={`px-1.5 py-1.5 text-right ${bold ? "font-semibold" : ""} ${
        border ? "border-l" : ""
      } ${red && value ? "text-red-600" : ""}`}
    >
      {value !== null && value !== undefined ? formatCurrency(value) : "\u2014"}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Performance Cells
// ---------------------------------------------------------------------------

type PerfByAccount = {
  label: string;
  beginningBalance: number;
  contributions: number;
  employerMatch: number;
  gainLoss: number;
  endingBalance: number;
}[];

/** Performance cell with per-account tooltip breakdown. */
export function PerfDetailCell({
  value,
  accounts,
  field,
  border,
  change,
}: {
  value: number | null;
  accounts: PerfByAccount;
  field: keyof PerfByAccount[0];
  border?: boolean;
  change?: boolean;
}) {
  const lines =
    accounts.length > 0
      ? accounts
          .filter((a) => a[field] !== 0)
          .sort(
            (a, b) =>
              Math.abs(b[field] as number) - Math.abs(a[field] as number),
          )
          .map((a) => {
            const v = a[field] as number;
            const formatted = change
              ? `${v >= 0 ? "+" : ""}${formatCurrency(v)}`
              : formatCurrency(v);
            return `${a.label}: ${formatted}`;
          })
      : undefined;

  const colorClass = change ? changeColor(value) : "";
  const display =
    value !== null
      ? change
        ? `${value >= 0 ? "+" : ""}${formatCurrency(value)}`
        : formatCurrency(value)
      : "\u2014";

  return (
    <td
      className={`px-1.5 py-1.5 text-right ${colorClass} ${
        border ? "border-l" : ""
      }`}
    >
      {lines && lines.length > 0 ? (
        <Tooltip lines={lines} side="bottom" maxWidth={400}>
          <span className="border-strong cursor-help border-b border-dotted">
            {display}
          </span>
        </Tooltip>
      ) : (
        display
      )}
    </td>
  );
}

/** End Bal cell for current year — shows snapshot value with tooltip explaining the difference */
export function PerfEndBalCell({
  value,
  perfLastUpdated,
  snapshotDate,
}: {
  value: number | null;
  perfLastUpdated: string;
  snapshotDate: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <td className="px-1.5 py-1.5 text-right">
      <span className="inline-flex items-center gap-0.5">
        <span>{value !== null ? formatCurrency(value) : "\u2014"}</span>
        <span
          className="text-micro inline-block h-3 w-3 cursor-help rounded-full bg-blue-100 text-center leading-3 font-bold text-blue-600"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          ?
        </span>
        {showTip && (
          <span
            className="text-caption pointer-events-none fixed z-[100] w-[260px] rounded bg-slate-900 px-2.5 py-1.5 leading-relaxed whitespace-normal text-slate-100 shadow-lg"
            style={{
              transform: "translate(-100%, -100%)",
              marginLeft: "-8px",
              marginTop: "-4px",
            }}
          >
            <span className="mb-0.5 block font-semibold">
              End Bal uses latest snapshot
            </span>
            This value comes from the portfolio snapshot (
            {fmtDate(snapshotDate)}) which is more current than the performance
            data (last updated {fmtDate(perfLastUpdated)}). Other fields
            (contributions, match, gain/loss) reflect the last update, so they
            won&apos;t sum to this total.
          </span>
        )}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Editable Cells
// ---------------------------------------------------------------------------

export function EditableCell({
  value,
  field,
  year,
  isCurrent,
  onSave,
  isSaving,
  border,
  red,
  notes,
  onUpsertNote,
  editableFields,
  tooltipLines,
}: {
  value: number | null;
  field: string;
  year: number;
  isCurrent: boolean;
  onSave: (year: number, fields: Record<string, number>) => void;
  isSaving: boolean;
  border?: boolean;
  red?: boolean;
  notes: Record<string, string>;
  onUpsertNote: (year: number, field: string, note: string) => void;
  editableFields?: Set<string>;
  tooltipLines?: string[];
}) {
  const {
    editingKey,
    editValue,
    setEditValue,
    startEdit: startEditRaw,
    commit,
    handleKeyDown,
  } = useInlineNumberEdit<true>({
    onCommit: (_key, draft) => {
      const parsed = parseFloat(draft);
      // homeImprovements is derived from the home_improvement_items table —
      // it is read-only in this table and not persisted via this save path.
      if (!isNaN(parsed) && parsed !== value && field !== "homeImprovements") {
        onSave(year, { [field]: parsed });
      }
    },
  });
  const startEdit = useCallback(() => {
    if (isCurrent) return;
    startEditRaw(true, value !== null ? String(value) : "");
  }, [value, isCurrent, startEditRaw]);

  const noteKey = `${year}:${field}`;
  const existingNote = notes[noteKey];

  if (editingKey) {
    return (
      <td className={`px-0.5 py-0.5 ${border ? "border-l" : ""}`}>
        <input
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-20 rounded border border-blue-300 px-1 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          autoFocus
          disabled={isSaving}
        />
      </td>
    );
  }

  const isEditable =
    !isCurrent && (editableFields ? editableFields.has(field) : true);
  return (
    <td
      className={`px-1.5 py-1.5 text-right ${border ? "border-l" : ""} ${
        red && value ? "text-red-600" : ""
      } ${isEditable ? "cursor-pointer transition-colors hover:bg-blue-50" : ""}`}
      onDoubleClick={isEditable ? startEdit : undefined}
      title={isEditable ? "Double-click to edit" : undefined}
    >
      <span className="group/cell relative inline-flex items-center gap-0.5">
        {tooltipLines && tooltipLines.length > 0 ? (
          <Tooltip lines={tooltipLines} side="bottom" maxWidth={400}>
            <span className="border-strong cursor-help border-b border-dotted">
              {value !== null && value !== undefined
                ? formatCurrency(value)
                : "\u2014"}
            </span>
          </Tooltip>
        ) : (
          <span>
            {value !== null && value !== undefined
              ? formatCurrency(value)
              : "\u2014"}
          </span>
        )}
        {existingNote && <NoteIndicator note={existingNote} />}
        {!isCurrent && (
          <NoteButton
            year={year}
            field={field}
            existingNote={existingNote}
            onUpsertNote={onUpsertNote}
          />
        )}
      </span>
    </td>
  );
}

export function EditableRateCell({
  value,
  field,
  year,
  isCurrent,
  onSave,
  isSaving,
  notes,
  onUpsertNote,
}: {
  value: number | null;
  field: string;
  year: number;
  isCurrent: boolean;
  onSave: (year: number, fields: Record<string, number>) => void;
  isSaving: boolean;
  notes: Record<string, string>;
  onUpsertNote: (year: number, field: string, note: string) => void;
}) {
  const {
    editingKey,
    editValue,
    setEditValue,
    startEdit: startEditRaw,
    commit,
    handleKeyDown,
  } = useInlineNumberEdit<true>({
    onCommit: (_key, draft) => {
      const parsed = parseFloat(draft);
      if (!isNaN(parsed)) {
        const rate = parsed / 100;
        if (rate !== value) {
          onSave(year, { [field]: rate });
        }
      }
    },
  });
  const startEdit = useCallback(() => {
    if (isCurrent) return;
    startEditRaw(true, value !== null ? (value * 100).toFixed(1) : "");
  }, [value, isCurrent, startEditRaw]);

  const noteKey = `${year}:${field}`;
  const existingNote = notes[noteKey];

  if (editingKey) {
    return (
      <td className="px-0.5 py-0.5">
        <input
          type="number"
          step="0.1"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-14 rounded border border-blue-300 px-1 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          autoFocus
          disabled={isSaving}
        />
      </td>
    );
  }

  const isEditable = !isCurrent;
  return (
    <td
      className={`px-1.5 py-1.5 text-right ${
        isEditable ? "cursor-pointer transition-colors hover:bg-blue-50" : ""
      }`}
      onDoubleClick={isEditable ? startEdit : undefined}
      title={isEditable ? "Double-click to edit" : undefined}
    >
      <span className="group/cell relative inline-flex items-center gap-0.5">
        <span>{value !== null ? formatPercent(value, 1) : "\u2014"}</span>
        {existingNote && <NoteIndicator note={existingNote} />}
        {!isCurrent && (
          <NoteButton
            year={year}
            field={field}
            existingNote={existingNote}
            onUpsertNote={onUpsertNote}
          />
        )}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Read-Only Line Item Cell — shows breakdown on click but no add/delete
// ---------------------------------------------------------------------------

export function ReadOnlyLineItemCell({
  value,
  items,
  year,
  type,
  notes,
  onUpsertNote,
  isCurrent,
}: {
  value: number;
  items: HIItem[];
  year: number;
  type: "homeImprovement" | "otherAsset";
  notes: Record<string, string>;
  onUpsertNote: (year: number, field: string, note: string) => void;
  isCurrent: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const field = type === "homeImprovement" ? "homeImprovements" : "otherAssets";
  const noteKey = `${year}:${field}`;
  const existingNote = notes[noteKey];

  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const hasItems = items.length > 0;

  return (
    <td className="relative px-1.5 py-1.5 text-right">
      <span className="group/cell relative inline-flex items-center gap-0.5">
        <span
          className={`${hasItems ? "cursor-pointer underline decoration-gray-400 decoration-dotted hover:text-blue-600" : ""}`}
          onClick={hasItems ? () => setExpanded(!expanded) : undefined}
          title={
            hasItems
              ? `Click to ${expanded ? "collapse" : "expand"} breakdown`
              : undefined
          }
        >
          {formatCurrency(value)}
        </span>
        {existingNote && <NoteIndicator note={existingNote} />}
        {!isCurrent && (
          <NoteButton
            year={year}
            field={field}
            existingNote={existingNote}
            onUpsertNote={onUpsertNote}
          />
        )}
      </span>
      {expanded && (
        <div
          ref={popoverRef}
          className="bg-surface-primary absolute top-full right-0 z-[9999] mt-1 min-w-[240px] rounded-lg border p-3 text-left shadow-xl"
        >
          <div className="text-muted mb-1.5 text-xs font-semibold">
            {type === "homeImprovement"
              ? `Home Improvements (through ${year})`
              : `Other Assets (${year})`}
          </div>
          {items.map((item) => (
            <div
              key={`${item.description}-${item.id}`}
              className="flex items-center justify-between py-0.5 text-xs"
            >
              <span
                className="text-secondary flex-1 truncate"
                title={item.note ?? undefined}
              >
                {item.description}
                {item.note && (
                  <span className="text-faint ml-1">({item.note})</span>
                )}
              </span>
              <span className="ml-3 font-medium tabular-nums">
                {formatCurrency(item.cost)}
              </span>
            </div>
          ))}
          {items.length > 0 && (
            <div className="mt-1 flex justify-between border-t pt-1 text-xs font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(value)}</span>
            </div>
          )}
        </div>
      )}
    </td>
  );
}
