"use client";

/** Sub-account UI: renders individual sub-account rows with owner/active controls, a collapsible inactive section, and an add-sub-account form. */

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
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
    },
  ) => void;
}) {
  const taxLabel = taxTypeLabel(sub.taxType);
  const subLabel = sub.label || sub.subType || taxLabel;
  const ownerName = sub.ownerPersonId
    ? (people.find((p) => p.id === sub.ownerPersonId)?.name ?? "?")
    : "Joint";
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(sub.label ?? "");

  function commitLabel() {
    setEditingLabel(false);
    const trimmed = labelDraft.trim();
    const next = trimmed || null;
    if (next !== (sub.label ?? null)) onUpdate?.(sub.id, { label: next });
  }

  return (
    <div
      className={`px-3 py-2 bg-surface-primary border border-subtle rounded text-xs ${!sub.isActive ? "opacity-50" : ""}`}
    >
      {/* Line 1: label + amount */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-secondary font-medium truncate flex items-center gap-1 min-w-0">
          {editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLabel();
                }
                if (e.key === "Escape") {
                  setEditingLabel(false);
                  setLabelDraft(sub.label ?? "");
                }
              }}
              placeholder={sub.subType || taxLabel}
              className="border-b border-blue-400 bg-transparent outline-none text-xs w-full min-w-0"
            />
          ) : (
            <>
              <span className="truncate">{subLabel}</span>
              {subLabel !== taxLabel && (
                <span className="text-faint font-normal shrink-0">
                  ({taxLabel})
                </span>
              )}
              {onUpdate && (
                <button
                  onClick={() => {
                    setLabelDraft(sub.label ?? "");
                    setEditingLabel(true);
                  }}
                  title="Edit label"
                  className="text-faint hover:text-secondary shrink-0 ml-0.5"
                >
                  ✎
                </button>
              )}
            </>
          )}
        </span>
        <span className="font-mono text-secondary shrink-0">
          {formatCurrency(parseFloat(sub.amount))}
        </span>
      </div>
      {/* Line 2: owner + action */}
      <div className="flex items-center justify-between gap-2 mt-1">
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
          className={`text-[10px] text-faint bg-transparent border-none p-0 focus:ring-0${onUpdate ? "cursor-pointer hover:text-secondary" : "cursor-default"}`}
          title={`Owner: ${ownerName}`}
        >
          <option value="">Joint</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {onUpdate && (
          <button
            onClick={() => onUpdate(sub.id, { isActive: !sub.isActive })}
            className={`text-[10px] shrink-0 ${sub.isActive ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}
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
    },
  ) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setShow(!show)}
        className="text-[10px] text-faint hover:text-secondary"
      >
        {show ? "Hide" : "Show"} {subs.length} inactive sub-account
        {subs.length > 1 ? "s" : ""}
      </button>
      {show && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 mt-2">
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
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/30 space-y-2">
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">
        New Sub-Account
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-muted">Tax Type</label>
          <select
            value={taxType}
            onChange={(e) => setTaxType(e.target.value)}
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          >
            <option value="preTax">Pre-Tax</option>
            <option value="taxFree">Tax-Free (Roth)</option>
            <option value="afterTax">After-Tax</option>
            <option value="hsa">HSA</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Sub-Type</label>
          <input
            type="text"
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
            placeholder="e.g. ESPP, Rollover"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Employer Match"
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Owner</label>
          <select
            value={owner ?? ""}
            onChange={(e) =>
              setOwner(e.target.value ? parseInt(e.target.value, 10) : null)
            }
            className="w-full border rounded px-1.5 py-1 text-xs bg-surface-primary"
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
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded text-muted hover:bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
