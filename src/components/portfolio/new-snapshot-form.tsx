"use client";

/** New portfolio snapshot editor — prefills rows from the latest snapshot,
 *  lets the user adjust each account balance (grouped by performance account),
 *  and submits via the portfolioSnapshots.create mutation. */

import { useState, useCallback, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  formatCurrency,
  accountDisplayName,
  personDisplayName,
} from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";

type PortfolioTaxType = "preTax" | "taxFree" | "hsa" | "afterTax";
type PortfolioAccountType = string; // Derived from DB text column; validated by ACCOUNT_TYPE_CONFIG

type AccountRow = {
  key: string; // stable key for React
  institution: string;
  accountType: PortfolioAccountType;
  subType: string | null;
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
      if (row.subType) {
        parts.push(`${row.subType} (${taxTypeLabel(row.taxType)})`);
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
      <Card title="New Snapshot" className="mb-6">
        <p className="text-sm text-muted">Loading latest snapshot data...</p>
      </Card>
    );
  }

  return (
    <Card title="New Snapshot" className="mb-6">
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
          {groupFormRows(currentRows, perfAccounts ?? [], people ?? []).map(
            (group) => {
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
                <div key={group.key} className="mb-3 last:mb-0">
                  {/* Group header */}
                  <div className="flex items-baseline gap-2 py-1.5 border-b border-strong">
                    <span className="flex-1 text-sm font-semibold text-primary">
                      {group.perfName}
                    </span>
                    <span className="text-xs text-muted w-24 text-right">
                      {groupPrev > 0 ? formatCurrency(groupPrev) : ""}
                    </span>
                    <span className="text-sm font-semibold text-primary w-32 text-right">
                      {formatCurrency(groupTotal)}
                    </span>
                    <span
                      className={`text-xs w-24 text-right ${
                        groupDelta > 0
                          ? "text-green-600"
                          : groupDelta < 0
                            ? "text-red-600"
                            : "text-faint"
                      }`}
                    >
                      {groupPrev > 0
                        ? `${groupDelta >= 0 ? "+" : ""}${formatCurrency(groupDelta)}`
                        : ""}
                    </span>
                  </div>
                  {/* Sub-rows */}
                  {group.rows.map((row) => {
                    const amt = parseFloat(row.amount) || 0;
                    const delta = amt - row.previousAmount;
                    return (
                      <div
                        key={row.key}
                        className="flex items-center gap-2 py-0.5 pl-4 border-b border-subtle"
                      >
                        <span className="flex-1 text-xs text-muted">
                          {row.subLabel}
                        </span>
                        <span className="text-xs text-faint w-24 text-right">
                          {row.previousAmount > 0
                            ? formatCurrency(row.previousAmount)
                            : "—"}
                        </span>
                        <span className="w-32 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={row.amount}
                            onChange={(e) =>
                              updateRow(row.key, "amount", e.target.value)
                            }
                            className="border rounded px-2 py-0.5 text-sm text-right w-28"
                          />
                        </span>
                        <span
                          className={`text-xs w-24 text-right whitespace-nowrap ${
                            delta > 0
                              ? "text-green-600"
                              : delta < 0
                                ? "text-red-600"
                                : "text-faint"
                          }`}
                        >
                          {row.previousAmount > 0
                            ? `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`
                            : "new"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            },
          )}
          {/* Total */}
          <div className="flex items-baseline gap-2 py-2 border-t-2 border-strong mt-2">
            <span className="flex-1 font-semibold">Total</span>
            <span className="w-24" />
            <span className="text-sm font-bold w-32 text-right">
              {formatCurrency(newTotal)}
            </span>
            <span
              className={`text-xs font-medium w-24 text-right ${
                totalDelta > 0
                  ? "text-green-600"
                  : totalDelta < 0
                    ? "text-red-600"
                    : "text-faint"
              }`}
            >
              {prevTotal > 0
                ? `${totalDelta >= 0 ? "+" : ""}${formatCurrency(totalDelta)}`
                : ""}
            </span>
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
            className="px-4 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
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
    </Card>
  );
}
