"use client";

/** Sub-account UI: renders individual sub-account rows with owner/active controls, a collapsible inactive section, and an add-sub-account form. */

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { taxTypeLabel, TAX_TYPE_COLORS } from "@/lib/utils/colors";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";
import type { PortfolioSub } from "./contribution-accounts-types";

export function SubAccountRow({
  sub,
  people,
  onUpdate,
}: {
  sub: PortfolioSub;
  people: { id: number; name: string }[];
  onUpdate?: (
    id: number,
    updates: {
      ownerPersonId?: number | null;
      isActive?: boolean;
      label?: string | null;
      taxType?: string;
    },
  ) => void;
}) {
  const taxLabel = taxTypeLabel(sub.taxType);
  const subLabel = sub.label || sub.subType || taxLabel;
  const ownerName = sub.ownerPersonId
    ? (people.find((p) => p.id === sub.ownerPersonId)?.name ?? "?")
    : "Joint";
  const {
    editingKey: editingLabel,
    editValue: labelDraft,
    setEditValue: setLabelDraft,
    startEdit: startEditLabel,
    commit: commitLabel,
    handleKeyDown: handleLabelKeyDown,
  } = useInlineNumberEdit<true>({
    allowBlankCommit: true,
    onCommit: (_key, draft) => {
      const next = draft.trim() || null;
      if (next !== (sub.label ?? null)) onUpdate?.(sub.id, { label: next });
    },
  });

  return (
    <div
      className={`bg-surface-primary border-subtle rounded border px-3 py-2 text-xs ${!sub.isActive ? "opacity-50" : ""}`}
    >
      {/* Line 1: label + amount */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-secondary flex min-w-0 items-center gap-1 truncate font-medium">
          {editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={handleLabelKeyDown}
              placeholder={sub.subType || taxLabel}
              className="w-full min-w-0 border-b border-blue-400 bg-transparent text-xs outline-none"
            />
          ) : (
            <>
              <span className="truncate">{subLabel}</span>
              {subLabel !== taxLabel && (
                <span className="text-faint shrink-0 font-normal">
                  ({taxLabel})
                </span>
              )}
              {onUpdate && (
                <button
                  onClick={() => startEditLabel(true, sub.label ?? "")}
                  title="Edit label"
                  className="text-faint hover:text-secondary ml-0.5 shrink-0"
                >
                  ✎
                </button>
              )}
            </>
          )}
        </span>
        <span className="text-secondary shrink-0 font-mono">
          {formatCurrency(parseFloat(sub.amount))}
        </span>
      </div>
      {/* Line 2: owner · tax type · action */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={sub.ownerPersonId ?? ""}
            onChange={(e) =>
              onUpdate?.(sub.id, {
                ownerPersonId: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
              })
            }
            disabled={!onUpdate}
            className={`text-caption text-faint border-none bg-transparent p-0 focus:ring-0${onUpdate ? "hover:text-secondary cursor-pointer" : "cursor-default"}`}
            title={`Owner: ${ownerName}`}
          >
            <option value="">Joint</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-faint text-caption">·</span>
          <select
            value={sub.taxType}
            onChange={(e) => onUpdate?.(sub.id, { taxType: e.target.value })}
            disabled={!onUpdate}
            className={`text-caption text-faint border-none bg-transparent p-0 focus:ring-0${onUpdate ? "hover:text-secondary cursor-pointer" : "cursor-default"}`}
            title="Tax type"
          >
            {Object.entries(TAX_TYPE_COLORS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {onUpdate && (
          <button
            onClick={() => onUpdate(sub.id, { isActive: !sub.isActive })}
            className={`text-caption shrink-0 ${sub.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
            title={sub.isActive ? "Deactivate" : "Reactivate"}
          >
            {sub.isActive ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
    </div>
  );
}

export function SubAccountInactiveSection({
  subs,
  people,
  onUpdate,
}: {
  subs: PortfolioSub[];
  people: { id: number; name: string }[];
  onUpdate?: (
    id: number,
    updates: {
      ownerPersonId?: number | null;
      isActive?: boolean;
      label?: string | null;
      taxType?: string;
    },
  ) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setShow(!show)}
        className="text-caption text-faint hover:text-secondary"
      >
        {show ? "Hide" : "Show"} {subs.length} inactive sub-account
        {subs.length > 1 ? "s" : ""}
      </button>
      {show && (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
          {subs.map((sub) => (
            <SubAccountRow
              key={sub.id}
              sub={sub}
              people={people}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Sub-Account Form
// ---------------------------------------------------------------------------

export function AddSubAccountForm({
  institution,
  accountType,
  parentCategory,
  ownerPersonId,
  people,
  onSave,
  onCancel,
}: {
  institution: string;
  accountType: string;
  parentCategory: string;
  ownerPersonId: number | null;
  people: { id: number; name: string }[];
  onSave: (data: {
    institution: string;
    taxType: string;
    amount: string;
    accountType: string;
    subType?: string | null;
    label?: string | null;
    parentCategory: string;
    ownerPersonId?: number | null;
  }) => void;
  onCancel: () => void;
}) {
  const [taxType, setTaxType] = useState("preTax");
  const [amount, setAmount] = useState("0");
  const [subType, setSubType] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState<number | null>(ownerPersonId);

  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
      <div className="text-caption text-muted font-semibold tracking-wider uppercase">
        New Sub-Account
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div>
          <label className="text-caption text-muted">Tax Type</label>
          <select
            value={taxType}
            onChange={(e) => setTaxType(e.target.value)}
            className="bg-surface-primary w-full rounded border px-1.5 py-1 text-xs"
          >
            {Object.entries(TAX_TYPE_COLORS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-caption text-muted">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="bg-surface-primary w-full rounded border px-1.5 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-caption text-muted">Sub-Type</label>
          <input
            type="text"
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
            placeholder="e.g. ESPP, Rollover"
            className="bg-surface-primary w-full rounded border px-1.5 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-caption text-muted">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Employer Match"
            className="bg-surface-primary w-full rounded border px-1.5 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-caption text-muted">Owner</label>
          <select
            value={owner ?? ""}
            onChange={(e) =>
              setOwner(e.target.value ? parseInt(e.target.value, 10) : null)
            }
            className="bg-surface-primary w-full rounded border px-1.5 py-1 text-xs"
          >
            <option value="">Joint</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() =>
            onSave({
              institution,
              taxType,
              amount: amount || "0",
              accountType,
              subType: subType.trim() || null,
              label: label.trim() || null,
              parentCategory,
              ownerPersonId: owner,
            })
          }
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="text-muted hover:bg-surface-elevated rounded px-3 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
