"use client";

/** Portfolio overview page showing account holdings, allocation, and point-in-time snapshots. */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  formatPercent,
  formatDate,
  accountDisplayName,
} from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { taxTypeLabel, accountColor } from "@/lib/utils/colors";
import {
  ACCOUNT_TYPE_CONFIG,
  type AccountCategory,
} from "@/lib/config/account-types";
import { confirm } from "@/components/ui/confirm-dialog";
import { ContributionAccountsSettings } from "@/components/portfolio/contribution-accounts";
import { PortfolioChart } from "@/components/portfolio/portfolio-chart";
import { CardBoundary } from "@/components/cards/dashboard/utils";

type PortfolioTaxType = "preTax" | "taxFree" | "hsa" | "afterTax";
type PortfolioAccountType = string; // Derived from DB text column; validated by ACCOUNT_TYPE_CONFIG

// Use centralized taxTypeLabel() from colors.ts for display labels

// ---------------------------------------------------------------------------
// Grouping helpers for snapshot display
// ---------------------------------------------------------------------------

type SnapshotAccountWithPerf = {
  institution: string;
  taxType: string;
  accountType: string;
  subType: string | null;
  amount: number;
  ownerPersonId: number | null;
  ownerName: string | null;
  performanceAccountId: number | null;
  perfAccountLabel: string | null;
  perfDisplayName: string | null;
  perfAccountType: string | null;
  perfOwnerPersonId: number | null;
};

type AccountGroup = {
  key: string;
  perfName: string;
  institution: string;
  perfAccountType: string | null;
  hasMultipleOwners: boolean;
  accounts: SnapshotAccountWithPerf[];
  total: number;
};

function groupByPerformanceAccount(
  accounts: SnapshotAccountWithPerf[],
): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const a of accounts) {
    const key = a.performanceAccountId
      ? `perf-${a.performanceAccountId}`
      : `unlinked-${a.institution}-${a.accountType}`;
    let group = groups.get(key);
    if (!group) {
      const perfName = accountDisplayName({
        displayName: a.perfDisplayName ?? null,
        accountLabel:
          a.perfAccountLabel ?? `${a.accountType} (${a.institution})`,
        accountType: a.accountType,
        institution: a.institution,
      });
      group = {
        key,
        perfName,
        institution: a.institution,
        perfAccountType: a.perfAccountType,
        hasMultipleOwners: false,
        accounts: [],
        total: 0,
      };
      groups.set(key, group);
    }
    group.accounts.push(a);
    group.total += a.amount;
  }
  // Detect multi-owner groups (e.g., joint IRA with multiple owner sub-rows)
  const result = Array.from(groups.values());
  for (const group of result) {
    const ownerIds = new Set(
      group.accounts.map((a: SnapshotAccountWithPerf) => a.ownerPersonId),
    );
    group.hasMultipleOwners = ownerIds.size > 1;
  }
  // Sort by institution first, then by name within institution
  return result.sort(
    (a, b) =>
      a.institution.localeCompare(b.institution) ||
      a.perfName.localeCompare(b.perfName),
  );
}

function buildSubRowLabel(
  a: SnapshotAccountWithPerf,
  group: AccountGroup,
): string {
  const parts: string[] = [];
  // Owner prefix for joint accounts with multiple owners
  if (group.hasMultipleOwners && a.ownerName) {
    parts.push(a.ownerName + " —");
  }
  // Show subType (e.g.,"Employer Match","Rollover") when present,
  // or raw accountType when it differs from the performance account type
  if (a.subType) {
    parts.push(`${a.subType} (${taxTypeLabel(a.taxType)})`);
  } else {
    const rawType = a.accountType.toLowerCase();
    const perfType = (group.perfAccountType ?? "").toLowerCase();
    if (rawType !== perfType && rawType !== a.taxType.toLowerCase()) {
      parts.push(`${a.accountType} (${taxTypeLabel(a.taxType)})`);
    } else {
      parts.push(taxTypeLabel(a.taxType));
    }
  }
  return parts.join("");
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
        parts.push(
          (row.ownerPersonId
            ? (peopleMap.get(row.ownerPersonId) ?? "Unknown")
            : "Joint") + " —",
        );
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

// ---------------------------------------------------------------------------

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

function NewSnapshotForm({
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

// ---------------------------------------------------------------------------
// Summary table helper — renders a list of label/amount rows with a total
// ---------------------------------------------------------------------------

function SummaryTable({
  title,
  rows,
  total,
  showPct = false,
}: {
  title: string;
  rows: { label: string; amount: number }[];
  total: number;
  showPct?: boolean;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between">
            <span className="text-xs text-muted">{r.label}</span>
            <span className="text-xs font-medium text-primary tabular-nums">
              {formatCurrency(r.amount)}
              {showPct && total > 0 && (
                <span className="text-faint ml-1">
                  ({formatPercent(r.amount / total, 1)})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between mt-1.5 pt-1.5 border-t">
        <span className="text-xs font-semibold text-secondary">Total</span>
        <span className="text-xs font-bold text-primary tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account balance overview — multi-panel summary
// ---------------------------------------------------------------------------

function AccountBalanceOverview() {
  const { data: latestSnap } =
    trpc.settings.portfolioSnapshots.getLatest.useQuery();
  const { data: perfAccounts } =
    trpc.settings.performanceAccounts.list.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();

  // Memoize all derived breakdowns from snapshot data. Hooks must be called
  // before any early return to preserve hook order.
  const overviewData = useMemo(() => {
    if (!latestSnap?.accounts || !perfAccounts || !people) return null;

    // Parse all snapshot accounts into numbers once
    const accounts = latestSnap.accounts.map((a) => ({
      ...a,
      amt: parseFloat(a.amount),
    }));

    const portfolioTotal = accounts.reduce((s, a) => s + a.amt, 0);
    if (portfolioTotal === 0) return null;

    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

    // --- By Account Type ---
    const byAccountType = new Map<string, number>();
    for (const a of accounts) {
      const pa = a.performanceAccountId
        ? perfMap.get(a.performanceAccountId)
        : null;
      const cat = pa?.accountType ?? a.accountType;
      byAccountType.set(cat, (byAccountType.get(cat) ?? 0) + a.amt);
    }
    const accountTypeRows = Array.from(byAccountType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => ({
        label: ACCOUNT_TYPE_CONFIG[cat as AccountCategory]?.displayLabel ?? cat,
        amount: amt,
      }));

    // --- By Institution ---
    const byInstitution = new Map<string, number>();
    for (const a of accounts) {
      byInstitution.set(
        a.institution,
        (byInstitution.get(a.institution) ?? 0) + a.amt,
      );
    }
    const institutionRows = Array.from(byInstitution.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([inst, amt]) => ({ label: inst, amount: amt }));

    // --- Per Person (detail: person + taxType) ---
    const byPersonTaxType = new Map<string, number>();
    for (const a of accounts) {
      const name = a.ownerPersonId
        ? (peopleMap.get(a.ownerPersonId) ?? "Unknown")
        : "Joint";
      const taxLabel = taxTypeLabel(a.taxType);
      const key = `${name} ${taxLabel}`;
      byPersonTaxType.set(key, (byPersonTaxType.get(key) ?? 0) + a.amt);
    }
    const personDetailRows = Array.from(byPersonTaxType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => ({ label, amount: amt }));

    // --- Per Person (totals) ---
    const byPerson = new Map<string, number>();
    for (const a of accounts) {
      const name = a.ownerPersonId
        ? (peopleMap.get(a.ownerPersonId) ?? "Unknown")
        : "Joint";
      byPerson.set(name, (byPerson.get(name) ?? 0) + a.amt);
    }
    const personRows = Array.from(byPerson.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amt]) => ({ label: name, amount: amt }));

    // --- By Tax Bucket ---
    const byTaxType = new Map<string, number>();
    for (const a of accounts) {
      const label = taxTypeLabel(a.taxType);
      byTaxType.set(label, (byTaxType.get(label) ?? 0) + a.amt);
    }
    const taxRows = Array.from(byTaxType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => ({ label, amount: amt }));

    // --- Per-Account bar chart (original view) ---
    const balanceByPerfId = new Map<number, number>();
    for (const a of accounts) {
      if (a.performanceAccountId) {
        balanceByPerfId.set(
          a.performanceAccountId,
          (balanceByPerfId.get(a.performanceAccountId) ?? 0) + a.amt,
        );
      }
    }
    const activeAccounts = perfAccounts
      .filter((pa) => pa.isActive && balanceByPerfId.has(pa.id))
      .sort(
        (a, b) =>
          (balanceByPerfId.get(b.id) ?? 0) - (balanceByPerfId.get(a.id) ?? 0),
      );
    const maxBalance = Math.max(
      ...activeAccounts.map((pa) => balanceByPerfId.get(pa.id) ?? 0),
      1,
    );

    return {
      portfolioTotal,
      accountTypeRows,
      institutionRows,
      personDetailRows,
      personRows,
      taxRows,
      activeAccounts,
      balanceByPerfId,
      maxBalance,
    };
  }, [latestSnap, perfAccounts, people]);

  if (!overviewData) return null;

  const {
    portfolioTotal,
    accountTypeRows,
    institutionRows,
    personDetailRows,
    personRows,
    taxRows,
    activeAccounts,
    balanceByPerfId,
    maxBalance,
  } = overviewData;

  return (
    <Card className="mt-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold text-secondary">
          Account Balances
        </h3>
        <span className="text-sm font-bold text-primary">
          {formatCurrency(portfolioTotal)}
        </span>
      </div>

      {/* Summary panels grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <SummaryTable
          title="By Account Type"
          rows={accountTypeRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="By Institution"
          rows={institutionRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="Per Person"
          rows={personRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="Tax Bucket"
          rows={taxRows}
          total={portfolioTotal}
          showPct
        />
      </div>

      {/* Per-person detail table */}
      <div className="mb-6">
        <SummaryTable
          title="Per Person Detail"
          rows={personDetailRows}
          total={portfolioTotal}
          showPct
        />
      </div>

      {/* Per-account bar chart */}
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
          By Account
        </h4>
        <div className="space-y-2">
          {activeAccounts.map((pa) => {
            const balance = balanceByPerfId.get(pa.id) ?? 0;
            const pct = (balance / maxBalance) * 100;
            return (
              <div key={pa.id} className="flex items-center gap-3">
                <div className="w-[140px] shrink-0 text-xs text-muted truncate">
                  {accountDisplayName(pa)}
                </div>
                <div className="flex-1 h-4 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${accountColor(pa.accountType)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-[90px] text-right text-xs font-medium text-secondary">
                  {formatCurrency(balance)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quick Look Stats Panel
// ---------------------------------------------------------------------------

function PortfolioQuickLook({
  snapshots,
}: {
  snapshots: { id: number; date: string; total: number }[];
}) {
  const [mode, setMode] = useState<"dollar" | "percent">("dollar");
  const stats = useMemo(() => {
    if (snapshots.length < 2) return null;
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
    const current = sorted[sorted.length - 1]!;
    const first = sorted[0]!;

    // All-time high
    const ath = sorted.reduce((best, s) => (s.total > best.total ? s : best));
    const athDistance = current.total - ath.total;
    const athDistancePct = ath.total > 0 ? (athDistance / ath.total) * 100 : 0;

    // Changes between consecutive snapshots
    const changes = sorted.slice(1).map((s, i) => {
      const prev = sorted[i]!;
      const delta = s.total - prev.total;
      const days = Math.round(
        (new Date(s.date).getTime() - new Date(prev.date).getTime()) / 86400000,
      );
      const periodReturn = prev.total > 0 ? delta / prev.total : 0;
      const deltaPct = periodReturn * 100;
      return { date: s.date, delta, deltaPct, days };
    });

    // Biggest gain / loss — $ mode uses raw delta, % mode uses raw %
    const biggestGainDollar = changes.reduce((best, c) =>
      c.delta > best.delta ? c : best,
    );
    const biggestLossDollar = changes.reduce((worst, c) =>
      c.delta < worst.delta ? c : worst,
    );
    const biggestGainPct = changes.reduce((best, c) =>
      c.deltaPct > best.deltaPct ? c : best,
    );
    const biggestLossPct = changes.reduce((worst, c) =>
      c.deltaPct < worst.deltaPct ? c : worst,
    );

    // Sharpest gain / loss — ranked by rate of change ($/day or %/day)
    const withRate = changes.filter((c) => c.days > 0);
    const sharpestGainDollar = withRate.reduce((best, c) =>
      c.delta / c.days > best.delta / best.days ? c : best,
    );
    const sharpestLossDollar = withRate.reduce((worst, c) =>
      c.delta / c.days < worst.delta / worst.days ? c : worst,
    );
    const sharpestGainPct = withRate.reduce((best, c) =>
      c.deltaPct / c.days > best.deltaPct / best.days ? c : best,
    );
    const sharpestLossPct = withRate.reduce((worst, c) =>
      c.deltaPct / c.days < worst.deltaPct / worst.days ? c : worst,
    );

    // YTD change
    const currentYear = new Date().getFullYear().toString();
    const firstOfYear =
      sorted.find((s) => s.date >= `${currentYear}-01-01`) ?? first;
    const ytdDelta = current.total - firstOfYear.total;
    const ytdPct =
      firstOfYear.total > 0
        ? ((current.total - firstOfYear.total) / firstOfYear.total) * 100
        : 0;

    // 52-week change
    const oneYearAgoDate = new Date();
    oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgoDate.toISOString().slice(0, 10);
    const yearAgoSnap = sorted.reduce<(typeof sorted)[number] | null>(
      (best, s) => {
        if (s.date > oneYearAgoStr) return best;
        return !best ||
          Math.abs(
            new Date(s.date).getTime() - new Date(oneYearAgoStr).getTime(),
          ) <
            Math.abs(
              new Date(best.date).getTime() - new Date(oneYearAgoStr).getTime(),
            )
          ? s
          : best;
      },
      null,
    );
    const weekChange52 = yearAgoSnap ? current.total - yearAgoSnap.total : null;
    const weekChange52Pct =
      yearAgoSnap && yearAgoSnap.total > 0
        ? ((current.total - yearAgoSnap.total) / yearAgoSnap.total) * 100
        : null;

    // Streak
    let streak = 0;
    let streakDir: "gain" | "loss" | null = null;
    for (let i = changes.length - 1; i >= 0; i--) {
      const dir = changes[i]!.delta >= 0 ? "gain" : "loss";
      if (streakDir === null) streakDir = dir;
      if (dir === streakDir) streak++;
      else break;
    }

    // Average change per snapshot period
    const avgDelta =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.delta, 0) / changes.length
        : 0;
    const avgDeltaPct =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length
        : 0;
    const avgDays =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.days, 0) / changes.length
        : 7;

    // Best/worst month — separate picks for $ vs %
    const byMonthDollar = new Map<string, number>();
    const byMonthPct = new Map<string, number>();
    for (const c of changes) {
      const month = c.date.slice(0, 7);
      byMonthDollar.set(month, (byMonthDollar.get(month) ?? 0) + c.delta);
      byMonthPct.set(month, (byMonthPct.get(month) ?? 0) + c.deltaPct);
    }
    const monthsDollar = [...byMonthDollar.entries()];
    const bestMonthDollar = monthsDollar.reduce(
      (best, [m, d]) => (d > best[1] ? [m, d] : best),
      monthsDollar[0] ?? ["", 0],
    );
    const worstMonthDollar = monthsDollar.reduce(
      (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
      monthsDollar[0] ?? ["", 0],
    );
    const monthsPctArr = [...byMonthPct.entries()];
    const bestMonthPct = monthsPctArr.reduce(
      (best, [m, d]) => (d > best[1] ? [m, d] : best),
      monthsPctArr[0] ?? ["", 0],
    );
    const worstMonthPct = monthsPctArr.reduce(
      (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
      monthsPctArr[0] ?? ["", 0],
    );

    // Volatility — stdev of per-period % changes
    const mean = changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length;
    const variance =
      changes.reduce((s, c) => s + (c.deltaPct - mean) ** 2, 0) /
      changes.length;
    const volatility = Math.sqrt(variance);

    // All-time growth vs first snapshot
    const allTimeGrowth = current.total - first.total;
    const allTimeGrowthPct =
      first.total > 0 ? ((current.total - first.total) / first.total) * 100 : 0;

    return {
      ath,
      athDistance,
      athDistancePct,
      isAtAth: Math.abs(athDistance) < 1,
      biggestGainDollar,
      biggestLossDollar,
      biggestGainPct,
      biggestLossPct,
      sharpestGainDollar,
      sharpestLossDollar,
      sharpestGainPct,
      sharpestLossPct,
      ytdDelta,
      ytdPct,
      weekChange52,
      weekChange52Pct,
      streak,
      streakDir,
      avgDelta,
      avgDeltaPct,
      bestMonthDollar,
      worstMonthDollar,
      bestMonthPct,
      worstMonthPct,
      volatility,
      avgDays,
      allTimeGrowth,
      allTimeGrowthPct,
      totalSnapshots: sorted.length,
      firstDate: first.date,
    };
  }, [snapshots]);

  if (!stats) return null;

  const isDollar = mode === "dollar";
  const clr = (v: number) => (v >= 0 ? "text-green-500" : "text-red-500");
  const sign = (v: number) => (v >= 0 ? "+" : "");
  const fmtPrimary = (dollars: number, percent: number) =>
    isDollar
      ? `${sign(dollars)}${formatCurrency(dollars)}`
      : `${sign(percent)}${formatPercent(percent / 100, 2)}`;
  const fmtSecondary = (dollars: number, percent: number) =>
    isDollar
      ? `${sign(percent)}${formatPercent(percent / 100, 1)}`
      : `${sign(dollars)}${formatCurrency(dollars)}`;
  const biggestGain = isDollar ? stats.biggestGainDollar : stats.biggestGainPct;
  const biggestLoss = isDollar ? stats.biggestLossDollar : stats.biggestLossPct;
  const sharpestGain = isDollar
    ? stats.sharpestGainDollar
    : stats.sharpestGainPct;
  const sharpestLoss = isDollar
    ? stats.sharpestLossDollar
    : stats.sharpestLossPct;
  const bestMonth = isDollar ? stats.bestMonthDollar : stats.bestMonthPct;
  const worstMonth = isDollar ? stats.worstMonthDollar : stats.worstMonthPct;
  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="mb-4 bg-surface-primary border rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-primary">
          Portfolio Quick Look
        </h3>
        <div className="inline-flex rounded-md border border-strong text-xs">
          <button
            type="button"
            onClick={() => setMode("dollar")}
            className={`px-2.5 py-1 rounded-l-md transition-colors ${isDollar ? "bg-indigo-600 text-white" : "text-muted hover:text-primary"}`}
          >
            $
          </button>
          <button
            type="button"
            onClick={() => setMode("percent")}
            className={`px-2.5 py-1 rounded-r-md transition-colors ${!isDollar ? "bg-indigo-600 text-white" : "text-muted hover:text-primary"}`}
          >
            %
          </button>
        </div>
      </div>
      <div className="space-y-4 text-sm">
        {/* Section: Performance */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Performance
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">All-Time High</div>
              <div className="font-medium">
                {formatCurrency(stats.ath.total)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(stats.ath.date, "medium")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">vs. Peak</div>
              <div
                className={`font-medium ${stats.isAtAth ? "text-green-500" : "text-red-500"}`}
              >
                {stats.isAtAth
                  ? "At all-time high"
                  : fmtPrimary(stats.athDistance, stats.athDistancePct)}
              </div>
              {!stats.isAtAth && (
                <div className="text-xs text-faint">
                  {fmtSecondary(stats.athDistance, stats.athDistancePct)}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted">YTD Change</div>
              <div className={`font-medium ${clr(stats.ytdDelta)}`}>
                {fmtPrimary(stats.ytdDelta, stats.ytdPct)}
              </div>
              <div className="text-xs text-faint">
                {fmtSecondary(stats.ytdDelta, stats.ytdPct)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">52-Week Change</div>
              {stats.weekChange52 != null ? (
                <>
                  <div className={`font-medium ${clr(stats.weekChange52)}`}>
                    {fmtPrimary(stats.weekChange52, stats.weekChange52Pct!)}
                  </div>
                  <div className="text-xs text-faint">
                    {fmtSecondary(stats.weekChange52, stats.weekChange52Pct!)}
                  </div>
                </>
              ) : (
                <div className="text-faint">Not enough data</div>
              )}
            </div>
          </div>
        </div>

        {/* Section: Extremes */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Extremes
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Biggest Gain</div>
              <div className="font-medium text-green-500">
                {fmtPrimary(biggestGain.delta, biggestGain.deltaPct)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(biggestGain.date, "medium")} ·{" "}
                {fmtSecondary(biggestGain.delta, biggestGain.deltaPct)} over{" "}
                {biggestGain.days}d
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Biggest Loss</div>
              <div className="font-medium text-red-500">
                {fmtPrimary(biggestLoss.delta, biggestLoss.deltaPct)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(biggestLoss.date, "medium")} ·{" "}
                {fmtSecondary(biggestLoss.delta, biggestLoss.deltaPct)} over{" "}
                {biggestLoss.days}d
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Sharpest Gain</div>
              <div className="font-medium text-green-500">
                {isDollar
                  ? `+${formatCurrency(sharpestGain.delta / sharpestGain.days)}/day`
                  : `+${formatPercent(sharpestGain.deltaPct / sharpestGain.days / 100, 2)}/day`}
              </div>
              <div className="text-xs text-faint">
                {formatDate(sharpestGain.date, "medium")} ·{" "}
                {fmtPrimary(sharpestGain.delta, sharpestGain.deltaPct)} over{" "}
                {sharpestGain.days}d
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Sharpest Loss</div>
              <div className="font-medium text-red-500">
                {isDollar
                  ? `${formatCurrency(sharpestLoss.delta / sharpestLoss.days)}/day`
                  : `${formatPercent(sharpestLoss.deltaPct / sharpestLoss.days / 100, 2)}/day`}
              </div>
              <div className="text-xs text-faint">
                {formatDate(sharpestLoss.date, "medium")} ·{" "}
                {fmtPrimary(sharpestLoss.delta, sharpestLoss.deltaPct)} over{" "}
                {sharpestLoss.days}d
              </div>
            </div>
          </div>
        </div>

        {/* Section: Trends */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Trends
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Current Streak</div>
              <div
                className={`font-medium ${stats.streakDir === "gain" ? "text-green-500" : "text-red-500"}`}
              >
                {stats.streak}{" "}
                {stats.streakDir === "gain"
                  ? `consecutive gain${stats.streak !== 1 ? "s" : ""}`
                  : `consecutive loss${stats.streak !== 1 ? "es" : ""}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Avg Change</div>
              <div className={`font-medium ${clr(stats.avgDelta)}`}>
                {fmtPrimary(stats.avgDelta, stats.avgDeltaPct)}
              </div>
              <div className="text-xs text-faint">
                {fmtSecondary(stats.avgDelta, stats.avgDeltaPct)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Best Month</div>
              <div className="font-medium text-green-500">
                {isDollar
                  ? `+${formatCurrency(bestMonth[1] as number)}`
                  : `+${formatPercent((bestMonth[1] as number) / 100, 2)}`}
              </div>
              <div className="text-xs text-faint">
                {fmtMonth(bestMonth[0] as string)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Worst Month</div>
              <div className="font-medium text-red-500">
                {isDollar
                  ? formatCurrency(worstMonth[1] as number)
                  : formatPercent((worstMonth[1] as number) / 100, 2)}
              </div>
              <div className="text-xs text-faint">
                {fmtMonth(worstMonth[0] as string)}
              </div>
            </div>
          </div>
        </div>

        {/* Section: Risk & Growth */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Risk & Growth
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Volatility</div>
              <div className="font-medium">
                {formatPercent(stats.volatility / 100, 2)} per snapshot
              </div>
              <div className="text-xs text-faint">
                Std dev of % changes (~{Math.round(stats.avgDays)}d avg gap)
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">All-Time Growth</div>
              <div className={`font-medium ${clr(stats.allTimeGrowth)}`}>
                {fmtPrimary(stats.allTimeGrowth, stats.allTimeGrowthPct)}
              </div>
              <div className="text-xs text-faint">
                Since {formatDate(stats.firstDate, "medium")} (
                {stats.totalSnapshots} snapshots)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.networth.computeSummary.useQuery();
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [snapshotDateFrom, setSnapshotDateFrom] = useState("");
  const [snapshotDateTo, setSnapshotDateTo] = useState("");
  const [showNewSnapshot, setShowNewSnapshot] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<
    "date" | "total" | "accounts" | "change" | "changePct" | null
  >(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const snapshotPageSize = showAll ? 1000 : 52;
  const { data: snapshotTotals } = trpc.networth.listSnapshotTotals.useQuery(
    undefined,
    {
      enabled: showChart || showQuickLook,
    },
  );
  const { data: paginatedSnapshots } = trpc.networth.listSnapshots.useQuery({
    page: showAll ? 1 : snapshotPage,
    pageSize: snapshotPageSize,
    dateFrom: snapshotDateFrom || undefined,
    dateTo: snapshotDateTo || undefined,
    sortCol: sortCol ?? undefined,
    sortDir: sortDir,
  });
  const deleteMutation = trpc.settings.portfolioSnapshots.delete.useMutation({
    onSuccess: () => {
      utils.networth.computeSummary.invalidate();
      utils.networth.listHistory.invalidate();
      utils.networth.listSnapshots.invalidate();
    },
  });

  const snapshotDate = data?.snapshotDate;

  // Memoize snapshot delta computation and sorting — must be before early returns
  const toggleSort = useCallback(
    (col: "date" | "total" | "accounts" | "change" | "changePct") => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir(col === "date" ? "asc" : "desc");
      }
    },
    [sortCol],
  );

  // Server computes delta/deltaPct and handles sorting — client just reads the result
  const rawSnapshots = useMemo(
    () => paginatedSnapshots?.snapshots ?? [],
    [paginatedSnapshots?.snapshots],
  );
  const sortedSnapshots = rawSnapshots;

  const sortIndicator = useCallback(
    (col: string) => {
      if (sortCol !== col) return " ↕";
      return sortDir === "asc" ? " ↑" : " ↓";
    },
    [sortCol, sortDir],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <SkeletonChart height={128} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load portfolio data: {error.message}
      </p>
    );
  }

  if (!data) {
    return (
      <EmptyState
        message="No portfolio data available."
        hint="Create a new snapshot to start tracking your portfolio."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Portfolio Snapshots"
        subtitle={
          snapshotDate
            ? `Last snapshot: ${formatDate(snapshotDate)}`
            : undefined
        }
      >
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQuickLook(!showQuickLook)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              showQuickLook
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-surface-strong text-secondary hover:bg-surface-strong"
            }`}
          >
            {showQuickLook ? "Hide Stats" : "Quick Look"}
          </button>
          <button
            type="button"
            onClick={() => setShowChart(!showChart)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              showChart
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-surface-strong text-secondary hover:bg-surface-strong"
            }`}
          >
            {showChart ? "Hide Chart" : "Chart"}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowNewSnapshot(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
            >
              New Snapshot
            </button>
          )}
        </span>
      </PageHeader>

      {/* Quick Look Stats Panel */}
      {showQuickLook && snapshotTotals && snapshotTotals.length >= 2 && (
        <PortfolioQuickLook snapshots={snapshotTotals} />
      )}

      {/* New Snapshot Form */}
      {canEdit && showNewSnapshot && (
        <NewSnapshotForm
          onClose={() => setShowNewSnapshot(false)}
          onSaved={() => {
            setShowNewSnapshot(false);
            utils.networth.computeSummary.invalidate();
            utils.networth.listHistory.invalidate();
            utils.networth.listSnapshots.invalidate();
            utils.settings.portfolioSnapshots.getLatest.invalidate();
          }}
        />
      )}

      {/* Portfolio value chart */}
      {showChart && snapshotTotals && snapshotTotals.length > 0 && (
        <CardBoundary title="Portfolio Chart">
          <PortfolioChart snapshots={snapshotTotals} />
        </CardBoundary>
      )}

      {/* Lightweight account balance overview */}
      <CardBoundary title="Account Balances">
        <AccountBalanceOverview />
      </CardBoundary>

      {/* Snapshot history (paginated, collapsed by default) */}
      <CardBoundary title="Snapshot History">
        {paginatedSnapshots && paginatedSnapshots.totalCount > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between px-5 py-3 bg-surface-primary border rounded-lg shadow-sm hover:bg-surface-sunken transition-colors"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs text-faint transition-transform ${showHistory ? "rotate-90" : ""}`}
                >
                  &#9654;
                </span>
                <span className="font-semibold text-primary">
                  Snapshot History
                </span>
                <span className="text-xs text-faint">
                  ({paginatedSnapshots.totalCount} snapshot
                  {paginatedSnapshots.totalCount !== 1 ? "s" : ""})
                </span>
              </div>
              <span className="text-xs text-faint">
                {showHistory ? "Click to collapse" : "Click to expand"}
              </span>
            </button>

            {showHistory && (
              <Card className="mt-0 rounded-t-none border-t-0">
                {/* Date range filter + Show All toggle */}
                <div className="flex flex-wrap items-end gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      value={snapshotDateFrom}
                      onChange={(e) => {
                        setSnapshotDateFrom(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border border-strong rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">
                      To
                    </label>
                    <input
                      type="date"
                      value={snapshotDateTo}
                      onChange={(e) => {
                        setSnapshotDateTo(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border border-strong rounded px-2 py-1 text-sm"
                    />
                  </div>
                  {(snapshotDateFrom || snapshotDateTo) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSnapshotDateFrom("");
                        setSnapshotDateTo("");
                        setSnapshotPage(1);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium pb-1"
                    >
                      Clear filters
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(!showAll);
                      setSnapshotPage(1);
                    }}
                    className={`text-xs font-medium pb-1 ${showAll ? "text-indigo-600 hover:text-indigo-800" : "text-muted hover:text-secondary"}`}
                  >
                    {showAll ? "Paginate (52/page)" : "Show all"}
                  </button>
                  <span className="text-xs text-faint pb-1">
                    {paginatedSnapshots.totalCount} snapshot
                    {paginatedSnapshots.totalCount !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-left py-2 pr-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("date")}
                        >
                          Date{sortIndicator("date")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("total")}
                        >
                          Total{sortIndicator("total")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("accounts")}
                        >
                          Accounts{sortIndicator("accounts")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("change")}
                        >
                          Change{sortIndicator("change")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("changePct")}
                        >
                          Change %{sortIndicator("changePct")}
                        </th>
                        <th className="text-right py-2 px-4 text-muted font-medium">
                          Gap
                        </th>
                        <th className="text-left py-2 px-4 text-muted font-medium">
                          Notes
                        </th>
                        <th className="py-2 pl-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSnapshots.map((snap, _i) => {
                        const delta = snap.delta;
                        const isExpanded = expandedSnapshot === snap.id;
                        const firstSnap = rawSnapshots[0];
                        const isLatest =
                          snapshotPage === 1 &&
                          !snapshotDateFrom &&
                          !snapshotDateTo &&
                          firstSnap?.id === snap.id;
                        return (
                          <React.Fragment key={snap.id}>
                            <tr
                              className={`border-b border-subtle cursor-pointer hover:bg-surface-sunken ${isExpanded ? "bg-surface-sunken" : ""}`}
                              onClick={() =>
                                setExpandedSnapshot(isExpanded ? null : snap.id)
                              }
                            >
                              <td className="py-2 pr-4 font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className={`text-[10px] text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  >
                                    &#9654;
                                  </span>
                                  {formatDate(snap.snapshotDate, "medium")}
                                </span>
                              </td>
                              <td className="text-right py-2 px-4 font-medium">
                                {formatCurrency(snap.total)}
                              </td>
                              <td className="text-right py-2 px-4 text-muted">
                                {snap.accountCount}
                              </td>
                              <td
                                className={`text-right py-2 px-4 text-xs ${delta !== null ? (delta >= 0 ? "text-green-600" : "text-red-600") : "text-faint"}`}
                              >
                                {delta !== null
                                  ? `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`
                                  : "\u2014"}
                              </td>
                              <td
                                className={`text-right py-2 px-4 text-xs ${snap.deltaPct !== null ? (snap.deltaPct >= 0 ? "text-green-600" : "text-red-600") : "text-faint"}`}
                              >
                                {snap.deltaPct !== null
                                  ? `${snap.deltaPct >= 0 ? "+" : ""}${formatPercent(snap.deltaPct / 100, 2)}`
                                  : "\u2014"}
                              </td>
                              <td className="text-right py-2 px-4 text-xs text-faint">
                                {snap.daysSincePrev != null
                                  ? `${snap.daysSincePrev}d`
                                  : "\u2014"}
                              </td>
                              <td className="py-2 px-4 text-muted text-xs truncate max-w-[200px]">
                                {snap.notes ?? ""}
                              </td>
                              <td
                                className="py-2 pl-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canEdit && !isLatest && (
                                  <button
                                    onClick={async () => {
                                      if (
                                        await confirm(
                                          `Delete snapshot from ${snap.snapshotDate}?`,
                                        )
                                      ) {
                                        deleteMutation.mutate({ id: snap.id });
                                      }
                                    }}
                                    className="text-xs text-red-400 hover:text-red-600"
                                  >
                                    Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                            {isExpanded && snap.accounts && (
                              <tr>
                                <td colSpan={6} className="py-0 px-0">
                                  <div className="bg-surface-sunken px-8 py-2">
                                    {groupByPerformanceAccount(
                                      snap.accounts,
                                    ).map((group) => (
                                      <div
                                        key={group.key}
                                        className="mb-2 last:mb-0"
                                      >
                                        {/* Group header — performance account name + subtotal */}
                                        <div className="flex justify-between items-baseline py-1 border-b">
                                          <span className="text-xs font-semibold text-primary">
                                            {group.perfName}
                                          </span>
                                          <span className="text-xs font-semibold text-primary">
                                            {formatCurrency(group.total)}
                                          </span>
                                        </div>
                                        {/* Sub-rows */}
                                        {group.accounts.map((a, ai) => {
                                          const subLabel = buildSubRowLabel(
                                            a,
                                            group,
                                          );
                                          return (
                                            <div
                                              // eslint-disable-next-line react/no-array-index-key -- SnapshotAccountWithPerf has no ID; index breaks ties when accountType/ownerPersonId/subType collide within a group
                                              key={`${a.accountType}-${a.ownerPersonId}-${a.subType}-${ai}`}
                                              className="flex justify-between items-baseline py-0.5 pl-4 border-b border-subtle"
                                            >
                                              <span className="text-xs text-muted">
                                                {subLabel}
                                              </span>
                                              <span className="text-xs text-secondary">
                                                {formatCurrency(a.amount)}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination controls (hidden when showing all) */}
                {!showAll && paginatedSnapshots.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}
                      disabled={snapshotPage <= 1}
                      className="px-3 py-1 text-sm text-muted hover:text-primary border border-strong rounded disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <span className="text-sm text-muted">
                      Page {paginatedSnapshots.page} of{" "}
                      {paginatedSnapshots.totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSnapshotPage((p) =>
                          Math.min(paginatedSnapshots.totalPages, p + 1),
                        )
                      }
                      disabled={snapshotPage >= paginatedSnapshots.totalPages}
                      className="px-3 py-1 text-sm text-muted hover:text-primary border border-strong rounded disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </CardBoundary>
      {/* Account & Contribution Settings — unified table for goal/owner/contributions */}
      <CardBoundary title="Contribution Account Settings">
        <div className="mt-8">
          <ContributionAccountsSettings />
        </div>
      </CardBoundary>
    </div>
  );
}
