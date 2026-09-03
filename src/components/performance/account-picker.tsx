"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";
import { accountDisplayName } from "@/lib/utils/format";
import type { MasterAccount } from "./types";

/**
 * Multi-select account picker for the Performance page's custom filtering
 * feature. Portal + search pattern borrowed from
 * src/components/budget/api-category-picker.tsx, but multi-select and
 * fully controlled — no internal mutations, unlike its single-select
 * ancestor (this component owns no server calls at all).
 */
export function AccountPicker({
  masterAccounts,
  selectedAccountIds,
  onChange,
}: {
  masterAccounts: MasterAccount[];
  selectedAccountIds: Set<number>;
  onChange: (ids: Set<number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const visibleAccounts = masterAccounts.filter(
    (m) => showInactive || m.isActive,
  );
  // Compare against the TRUE total (all master accounts), not just the
  // currently-visible list — the default selection includes inactive
  // accounts (see page.tsx), so comparing against a showInactive-filtered
  // count here would produce a nonsensical "21 of 8" when inactive
  // accounts are hidden but still selected.
  const allIds = new Set(masterAccounts.map((m) => m.id));

  const groups = new Map<string, MasterAccount[]>();
  for (const m of visibleAccounts) {
    if (
      search &&
      !accountDisplayName(m, m.ownerName ?? undefined)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      !m.institution.toLowerCase().includes(search.toLowerCase())
    ) {
      continue;
    }
    const key = accountTypeToPerformanceCategory(m.accountType);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  const toggle = (id: number) => {
    const next = new Set(selectedAccountIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleGroup = (accts: MasterAccount[], select: boolean) => {
    const next = new Set(selectedAccountIds);
    for (const m of accts) {
      if (select) next.add(m.id);
      else next.delete(m.id);
    }
    onChange(next);
  };

  const summaryLabel =
    selectedAccountIds.size === 0
      ? "No accounts"
      : allIds.size > 0 &&
          [...allIds].every((id) => selectedAccountIds.has(id)) &&
          selectedAccountIds.size === allIds.size
        ? "All accounts"
        : `${selectedAccountIds.size} of ${allIds.size} accounts`;

  return (
    <>
      <button
        onClick={(e) => {
          setAnchorRect(e.currentTarget.getBoundingClientRect());
          setOpen(!open);
        }}
        className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors"
        title="Choose specific accounts to include"
      >
        {summaryLabel}
      </button>

      {open &&
        anchorRect &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              role="presentation"
            />
            <div
              className="bg-surface-primary fixed z-50 max-h-96 w-80 overflow-y-auto rounded-lg border p-3 shadow-lg"
              style={{
                top: anchorRect.bottom + 4,
                left: Math.min(anchorRect.left, window.innerWidth - 340),
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted text-xs font-medium">
                  Select accounts
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className="text-faint hover:text-secondary text-xs"
                >
                  Close
                </button>
              </div>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search accounts..."
                className="mb-2 w-full rounded border px-2 py-1 text-xs"
                autoFocus
              />

              <div className="text-caption mb-2 flex items-center justify-between">
                <button
                  onClick={() => onChange(new Set(allIds))}
                  className="text-blue-600 hover:text-blue-700"
                >
                  Select all
                </button>
                <button
                  onClick={() => onChange(new Set())}
                  className="text-blue-600 hover:text-blue-700"
                >
                  Select none
                </button>
                <label className="text-faint inline-flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                  />
                  Show closed
                </label>
              </div>

              {groups.size === 0 && (
                <p className="text-faint py-4 text-center text-xs">
                  No accounts match.
                </p>
              )}

              {[...groups.entries()].map(([category, accts]) => {
                const allSelected = accts.every((m) =>
                  selectedAccountIds.has(m.id),
                );
                return (
                  <div key={category} className="mb-1">
                    <div className="flex items-center justify-between px-1 py-0.5">
                      <span className="text-caption text-muted font-semibold tracking-wider uppercase">
                        {category}
                      </span>
                      <button
                        onClick={() => toggleGroup(accts, !allSelected)}
                        className="text-micro text-blue-600 hover:text-blue-700"
                      >
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    {accts.map((m) => (
                      <label
                        key={m.id}
                        className="text-secondary flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-blue-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(m.id)}
                          onChange={() => toggle(m.id)}
                        />
                        <span className={m.isActive ? "" : "text-faint"}>
                          {m.institution} —{" "}
                          {accountDisplayName(m, m.ownerName ?? undefined)}
                          {!m.isActive && " (closed)"}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
