"use client";

/** New portfolio snapshot editor — prefills rows from the latest snapshot,
 *  lets the user adjust each account balance (grouped by performance account),
 *  and submits via the portfolioSnapshots.create mutation. */

import { useState, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  formatCurrency,
  accountDisplayName,
  personDisplayName,
} from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import { TrendingUp, TrendingDown } from "lucide-react";

type PortfolioTaxType = "preTax" | "taxFree" | "hsa" | "afterTax";
type PortfolioAccountType = string; // Derived from DB text column; validated by ACCOUNT_TYPE_CONFIG

type AccountRow = {
  key: string; // stable key for React
  institution: string;
  accountType: PortfolioAccountType;
  subType: string | null;
  label: string | null;
  taxType: PortfolioTaxType;
  ownerPersonId: number | null;
  amount: string; // editable string
  previousAmount: number; // from latest snapshot, 0 for new rows
  performanceAccountId: number | null; // FK to performance_accounts master
};

let rowKeyCounter = 0;
function nextKey() {
  return `row-${++rowKeyCounter}`;
}

// Form-specific grouping: works with AccountRow + perfAccounts + people data
type FormRowGroup = {
  key: string;
  perfName: string;
  institution: string;
  rows: (AccountRow & { subLabel: string })[];
};

function groupFormRows(
  rows: AccountRow[],
  perfAccounts: {
    id: number;
    accountLabel: string;
    displayName: string | null;
    accountType: string;
    ownerPersonId: number | null;
  }[],
  people: { id: number; name: string }[],
): FormRowGroup[] {
  const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));
  const peopleMap = new Map(people.map((p) => [p.id, p.name]));
  const groups = new Map<string, FormRowGroup>();

  for (const row of rows) {
    const pa = row.performanceAccountId
      ? perfMap.get(row.performanceAccountId)
      : null;
    const key = row.performanceAccountId
      ? `perf-${row.performanceAccountId}`
      : `unlinked-${row.institution}-${row.accountType}`;

    let group = groups.get(key);
    if (!group) {
      const perfName = accountDisplayName(
        pa ?? {
          displayName: null,
          accountLabel: `${row.accountType} (${row.institution})`,
          accountType: row.accountType,
          institution: row.institution,
        },
      );
      group = { key, perfName, institution: row.institution, rows: [] };
      groups.set(key, group);
    }
    group.rows.push({ ...row, subLabel: "" }); // subLabel computed below
  }

  // Compute sub-labels (owner prefix + sub-account type + tax type)
  const allGroups = Array.from(groups.values());
  for (const group of allGroups) {
    const ownerIds = new Set(
      group.rows.map((r: AccountRow & { subLabel: string }) => r.ownerPersonId),
    );
    const hasMultipleOwners = ownerIds.size > 1;
    const pa = group.rows[0]?.performanceAccountId
      ? perfMap.get(group.rows[0].performanceAccountId)
      : null;
    const perfAccountType = (pa?.accountType ?? "").toLowerCase();

    for (const row of group.rows) {
      const parts: string[] = [];
      if (hasMultipleOwners) {
        parts.push(personDisplayName(row.ownerPersonId, peopleMap) + " —");
      }
      const displayName = row.label || row.subType;
      if (displayName) {
        parts.push(`${displayName} (${taxTypeLabel(row.taxType)})`);
      } else {
        const rawType = row.accountType.toLowerCase();
        if (
          rawType !== perfAccountType &&
          rawType !== row.taxType.toLowerCase()
        ) {
          parts.push(`${row.accountType} (${taxTypeLabel(row.taxType)})`);
        } else {
          parts.push(taxTypeLabel(row.taxType));
        }
      }
      row.subLabel = parts.join("");
    }
  }

  // Sort by institution first, then by name within institution
  return allGroups.sort(
    (a, b) =>
      a.institution.localeCompare(b.institution) ||
      a.perfName.localeCompare(b.perfName),
  );
}

export function NewSnapshotForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: latestSnap, isLoading: loadingLatest } =
    trpc.settings.portfolioSnapshots.getLatest.useQuery();
  const { data: perfAccounts } =
    trpc.settings.performanceAccounts.list.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const createMutation = trpc.settings.portfolioSnapshots.create.useMutation({
    onSuccess: (data) => {
      // eslint-disable-next-line no-restricted-syntax -- type narrowing for untyped API response
      const sync = (data as unknown as Record<string, unknown>)
        ?.apiSyncResult as
        | { pushed?: boolean; accountsPushed?: number; error?: string }
        | undefined;
      if (sync?.pushed && (sync.accountsPushed ?? 0) > 0) {
        setSyncMessage(
          `Snapshot saved. Pushed ${sync.accountsPushed} account${(sync.accountsPushed ?? 0) > 1 ? "s" : ""} to budget API.`,
        );
      } else if (sync?.error) {
        setSyncMessage(`Snapshot saved. Budget API push failed: ${sync.error}`);
      } else if (sync?.pushed && sync.accountsPushed === 0) {
        setSyncMessage(
          "Snapshot saved. Budget API accounts already up to date.",
        );
      }
      onSaved();
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const [snapshotDate, setSnapshotDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const didInit = useRef(false);

  // Once latest snapshot data loads, pre-fill rows (only once)
  useEffect(() => {
    if (didInit.current || loadingLatest) return;
    didInit.current = true;
    const initial: AccountRow[] =
      latestSnap?.accounts.map((a) => ({
        key: nextKey(),
        institution: a.institution,
        accountType: a.accountType,
        subType: a.subType ?? null,
        label: a.label ?? null,
        taxType: a.taxType,
        ownerPersonId: a.ownerPersonId,
        amount: a.amount,
        previousAmount: parseFloat(a.amount),
        performanceAccountId: a.performanceAccountId ?? null,
      })) ?? [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time initialization from query data
    setRows(initial);
  }, [loadingLatest, latestSnap]);

  const updateRow = useCallback(
    (key: string, field: keyof AccountRow, value: string | number) => {
      setRows((prev) =>
        (prev ?? []).map((r) => (r.key === key ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const handleSave = () => {
    if (!rows) return;
    const accounts = rows
      .filter((r) => r.institution.trim() !== "")
      .map((r) => ({
        institution: r.institution,
        taxType: r.taxType,
        accountType:
          r.accountType as import("@/lib/config/account-types").AccountCategory,
        amount: r.amount,
        ownerPersonId: r.ownerPersonId,
        performanceAccountId: r.performanceAccountId,
      }));
    createMutation.mutate({
      snapshotDate,
      notes: notes || null,
      accounts,
    });
  };

  const currentRows = rows ?? [];
  const newTotal = currentRows.reduce(
    (s, r) => s + (parseFloat(r.amount) || 0),
    0,
  );
  const prevTotal = currentRows.reduce((s, r) => s + r.previousAmount, 0);
  const totalDelta = newTotal - prevTotal;

  if (loadingLatest) {
    return (
      <p className="text-sm text-muted">Loading latest snapshot data...</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date + notes */}
      <div className="flex gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Snapshot Date
          </label>
          <input
            type="date"
            value={snapshotDate}
            onChange={(e) => setSnapshotDate(e.target.value)}
            className="border border-strong rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-muted mb-1">
            Notes (optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Monthly snapshot"
            className="border border-strong rounded px-2 py-1 text-sm w-full"
          />
        </div>
      </div>

      {/* Account rows — grouped by performance account */}
      <div>
        {(() => {
          const allGroups = groupFormRows(
            currentRows,
            perfAccounts ?? [],
            people ?? [],
          );
          // Bucket by institution (order preserved from groupFormRows sort)
          const byInstitution = new Map<string, typeof allGroups>();
          for (const g of allGroups) {
            const arr = byInstitution.get(g.institution) ?? [];
            arr.push(g);
            byInstitution.set(g.institution, arr);
          }
          return Array.from(byInstitution.entries()).map(
            ([institution, instGroups]) => {
              const instTotal = instGroups.reduce(
                (s, g) =>
                  s +
                  g.rows.reduce((rs, r) => rs + (parseFloat(r.amount) || 0), 0),
                0,
              );
              const instPrev = instGroups.reduce(
                (s, g) =>
                  s + g.rows.reduce((rs, r) => rs + r.previousAmount, 0),
                0,
              );
              const instDelta = instTotal - instPrev;
              return (
                <div key={institution} className="mb-4 last:mb-0">
                  {/* Institution header */}
                  <div className="flex items-center gap-3 py-1.5 border-b-2 border-strong">
                    <span className="flex-1 text-sm font-bold text-primary">
                      {institution}
                    </span>
                    <span className="text-sm font-bold text-primary tabular-nums">
                      {formatCurrency(instTotal)}
                    </span>
                    {instPrev > 0 && instDelta !== 0 && (
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                          instDelta > 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {instDelta > 0 ? (
                          <TrendingUp className="w-3 h-3 flex-shrink-0" />
                        ) : (
                          <TrendingDown className="w-3 h-3 flex-shrink-0" />
                        )}
                        {formatCurrency(Math.abs(instDelta))}
                      </span>
                    )}
                  </div>
                  {instGroups.map((group) => {
                    const groupTotal = group.rows.reduce(
                      (s, r) => s + (parseFloat(r.amount) || 0),
                      0,
                    );
                    const groupPrev = group.rows.reduce(
                      (s, r) => s + r.previousAmount,
                      0,
                    );
                    const groupDelta = groupTotal - groupPrev;
                    return (
                      <div key={group.key} className="mb-2 last:mb-0">
                        {/* Account sub-header */}
                        <div className="flex items-center gap-3 py-1 pl-3 border-b border-strong">
                          <span className="flex-1 text-xs font-semibold text-primary">
                            {group.perfName}
                          </span>
                          <span className="text-xs font-semibold text-primary tabular-nums">
                            {formatCurrency(groupTotal)}
                          </span>
                          {groupPrev > 0 && groupDelta !== 0 && (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${
                                groupDelta > 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {groupDelta > 0 ? (
                                <TrendingUp className="w-3 h-3 flex-shrink-0" />
                              ) : (
                                <TrendingDown className="w-3 h-3 flex-shrink-0" />
                              )}
                              {formatCurrency(Math.abs(groupDelta))}
                            </span>
                          )}
                        </div>
                        {/* Sub-rows */}
                        {group.rows.map((row) => {
                          const amt = parseFloat(row.amount) || 0;
                          const delta = amt - row.previousAmount;
                          const changed =
                            row.previousAmount > 0 && Math.abs(delta) > 0.005;
                          return (
                            <div
                              key={row.key}
                              className="flex items-center gap-3 py-1.5 pl-6 border-b border-subtle"
                            >
                              <span className="flex-1 text-xs text-muted">
                                {row.subLabel}
                              </span>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center border border-default rounded focus-within:ring-1 focus-within:ring-blue-500">
                                  <span className="pl-1.5 text-xs text-muted select-none">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.amount}
                                    onChange={(e) =>
                                      updateRow(
                                        row.key,
                                        "amount",
                                        e.target.value,
                                      )
                                    }
                                    className="w-28 bg-transparent px-1 py-0.5 text-xs text-right text-primary focus:outline-none"
                                  />
                                </div>
                                {row.previousAmount === 0 ? (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-surface-sunken text-faint font-medium">
                                    new
                                  </span>
                                ) : changed ? (
                                  <span className="text-[10px] text-faint tabular-nums">
                                    was {formatCurrency(row.previousAmount)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            },
          );
        })()}
        {/* Total */}
        <div className="flex items-center gap-3 py-2 border-t-2 border-strong mt-2">
          <span className="flex-1 text-sm font-semibold">Total</span>
          <span className="text-sm font-bold tabular-nums">
            {formatCurrency(newTotal)}
          </span>
          {prevTotal > 0 && totalDelta !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                totalDelta > 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {totalDelta > 0 ? (
                <TrendingUp className="w-3 h-3 flex-shrink-0" />
              ) : (
                <TrendingDown className="w-3 h-3 flex-shrink-0" />
              )}
              {formatCurrency(Math.abs(totalDelta))}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-muted hover:text-primary border border-strong rounded"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={createMutation.isPending || currentRows.length === 0}
          className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
        >
          {createMutation.isPending ? "Saving..." : "Save Snapshot"}
        </button>
      </div>

      {createMutation.isError && (
        <p className="text-sm text-red-600">
          Error: {createMutation.error.message}
        </p>
      )}
      {syncMessage && (
        <p
          className={`text-sm ${syncMessage.includes("failed") ? "text-amber-600" : "text-green-600"}`}
        >
          {syncMessage}
        </p>
      )}
    </div>
  );
}
