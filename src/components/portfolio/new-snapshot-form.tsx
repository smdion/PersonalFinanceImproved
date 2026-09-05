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
import { localDateStr } from "@/lib/utils/date";
import { getDisplayConfig } from "@/lib/config/account-types";
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
  /** True when the linked master account is closed — the server always
   *  records this row's balance as $0 regardless of what's submitted (see
   *  resolveSnapshotAccountAmounts), so the row is shown/held at $0 here
   *  too rather than displaying a stale total the save won't match. */
  isClosedAccount: boolean;
};

let rowKeyCounter = 0;
function nextKey() {
  return `row-${++rowKeyCounter}`;
}

// ── Local draft (browser only) ──────────────────────────────────────────
// The new-snapshot form has ~30 balance fields; a draft lets you stop
// partway and resume. Keyed by snapshot date so starting a snapshot for a
// new date never inherits a stale draft. One draft per date, per browser,
// not shared across devices/users (accepted limitation, shipped v0.8.2).

const DRAFT_PREFIX = "pf-snapshot-draft:";

type SnapshotDraft = {
  snapshotDate: string;
  notes: string;
  /** The `getLatest` snapshot id the rows were prefilled from — lets a
   *  resume detect that the account set changed and reconcile. */
  sourceSnapshotId: number | null;
  savedAt: number;
  rows: {
    performanceAccountId: number | null;
    institution: string;
    accountType: string;
    taxType: PortfolioTaxType;
    amount: string;
  }[];
};

function draftKey(date: string) {
  return `${DRAFT_PREFIX}${date}`;
}

function readDraft(date: string): SnapshotDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotDraft;
    return parsed && Array.isArray(parsed.rows) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(d: SnapshotDraft): void {
  try {
    window.localStorage.setItem(draftKey(d.snapshotDate), JSON.stringify(d));
  } catch {
    /* private mode / quota — a lost draft is acceptable */
  }
}

function clearDraft(date: string): void {
  try {
    window.localStorage.removeItem(draftKey(date));
  } catch {
    /* ignore */
  }
}

/** Overlay a draft's typed amounts onto a freshly-built row set — keeps
 *  the CURRENT account set (added masters appear, removed ones are gone)
 *  and only carries the draft's amounts + notes forward. */
function reconcileDraft(
  base: AccountRow[],
  draft: SnapshotDraft,
): AccountRow[] {
  const byPerf = new Map<number, string>();
  const byUnlinked = new Map<string, string>();
  for (const r of draft.rows) {
    if (r.performanceAccountId != null) {
      byPerf.set(r.performanceAccountId, r.amount);
    } else {
      byUnlinked.set(
        `${r.institution}|${r.accountType}|${r.taxType}`,
        r.amount,
      );
    }
  }
  return base.map((row) => {
    if (row.isClosedAccount) return row; // server zeroes these regardless
    const draftAmount =
      row.performanceAccountId != null
        ? byPerf.get(row.performanceAccountId)
        : byUnlinked.get(
            `${row.institution}|${row.accountType}|${row.taxType}`,
          );
    return draftAmount === undefined ? row : { ...row, amount: draftAmount };
  });
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
          // null, not a hand-built fallback string — lets accountDisplayName
          // fall through to its casing-aware construction instead of
          // returning a raw lowercase DB key verbatim.
          accountLabel: null,
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
    const pa = group.rows[0]?.performanceAccountId
      ? perfMap.get(group.rows[0].performanceAccountId)
      : null;
    // DESIGN.md's owner-prefix rule is a two-part test: the performance
    // account must be joint (ownerPersonId null) AND sub-rows must carry
    // different ownerPersonId values. An unlinked group (pa === null) has
    // no performance account to check jointness against — falls back to
    // the owner-id-diff check alone, matching groupByPerformanceAccount's
    // unlinked-group behavior in portfolio-content.tsx.
    const isJointPerfAccount = pa ? pa.ownerPersonId == null : true;
    const ownerIds = new Set(
      group.rows.map((r: AccountRow & { subLabel: string }) => r.ownerPersonId),
    );
    const hasMultipleOwners = isJointPerfAccount && ownerIds.size > 1;
    const perfAccountType = (pa?.accountType ?? "").toLowerCase();

    for (const row of group.rows) {
      const owner = hasMultipleOwners
        ? personDisplayName(row.ownerPersonId, peopleMap)
        : null;
      const taxLabel = taxTypeLabel(row.taxType);
      // DESIGN.md's sub-account-type rule only names subType, but `label` is
      // a real, separate free-text override column — takes precedence when
      // set (see DESIGN.md).
      const displayName = row.label || row.subType;

      let typeLabel: string;
      if (displayName) {
        typeLabel = displayName;
      } else {
        const rawType = row.accountType.toLowerCase();
        // Documented rule (DESIGN.md): show accountType only if it differs
        // from the parent performance account's type. The extra
        // `rawType !== taxType` condition previously suppressed this label
        // whenever accountType happened to equal the taxType string (e.g.
        // "hsa" vs "hsa"), which isn't in the spec.
        typeLabel =
          rawType !== perfAccountType
            ? getDisplayConfig(row.accountType).displayLabel
            : taxLabel;
      }

      if (owner) {
        // Owner prefix uses an em dash (DESIGN.md "Snapshot Display" — WHO
        // owns it), distinct from parens (WHAT kind of sub-account). Same
        // fix as portfolio-content.tsx's buildSubRowLabel (decision point 1,
        // 2026-08-19) — this file has its own copy of the same logic.
        const qualifier =
          typeLabel !== taxLabel ? `${typeLabel} · ${taxLabel}` : typeLabel;
        row.subLabel = `${owner} — ${qualifier}`;
      } else {
        row.subLabel =
          typeLabel !== taxLabel ? `${typeLabel} (${taxLabel})` : typeLabel;
      }
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
    trpc.networth.portfolioSnapshots.getLatest.useQuery();
  const { data: perfAccounts, isLoading: loadingPerfAccounts } =
    trpc.performance.performanceAccounts.list.useQuery();
  const { data: people, isLoading: loadingPeople } =
    trpc.settings.people.list.useQuery();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const createMutation = trpc.networth.portfolioSnapshots.create.useMutation({
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
      clearDraft(snapshotDate);
      onSaved();
    },
  });

  const { data: snapshotTotals } = trpc.networth.listSnapshotTotals.useQuery();

  const today = localDateStr();
  const [snapshotDate, setSnapshotDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [pendingDraft, setPendingDraft] = useState<SnapshotDraft | null>(null);
  const didInit = useRef(false);

  const buildInitialRows = useCallback((): AccountRow[] => {
    const closedMasterIds = new Set(
      (perfAccounts ?? []).filter((p) => !p.isActive).map((p) => p.id),
    );
    return (
      latestSnap?.accounts.map((a) => {
        const isClosedAccount =
          a.performanceAccountId != null &&
          closedMasterIds.has(a.performanceAccountId);
        return {
          key: nextKey(),
          institution: a.institution,
          accountType: a.accountType,
          subType: a.subType ?? null,
          label: a.label ?? null,
          taxType: a.taxType,
          ownerPersonId: a.ownerPersonId,
          // A closed account's balance is always recorded as $0 by the
          // server (see resolveSnapshotAccountAmounts) — show it that way
          // here too rather than a stale amount the save won't match.
          amount: isClosedAccount ? "0" : a.amount,
          previousAmount: isClosedAccount ? 0 : parseFloat(a.amount),
          performanceAccountId: a.performanceAccountId ?? null,
          isClosedAccount,
        };
      }) ?? []
    );
  }, [latestSnap, perfAccounts]);

  // Once latest snapshot data loads, pre-fill rows (only once). If a local
  // draft exists for this date AND the date isn't already a saved
  // snapshot, surface a resume prompt rather than restoring it silently.
  useEffect(() => {
    if (didInit.current || loadingLatest || loadingPerfAccounts) return;
    didInit.current = true;
    setRows(buildInitialRows());

    const dateTaken = (snapshotTotals ?? []).some((s) => s.date === today);
    const draft = readDraft(today);
    if (draft && draft.rows.length > 0 && !dateTaken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init: surface a localStorage draft, same pattern as setRows above
      setPendingDraft(draft);
    }
  }, [
    loadingLatest,
    loadingPerfAccounts,
    buildInitialRows,
    snapshotTotals,
    today,
  ]);

  const resumeDraft = useCallback(() => {
    if (!pendingDraft) return;
    setRows(reconcileDraft(buildInitialRows(), pendingDraft));
    setNotes(pendingDraft.notes);
    setDraftSavedAt(pendingDraft.savedAt);
    setPendingDraft(null);
  }, [pendingDraft, buildInitialRows]);

  const discardDraft = useCallback(() => {
    clearDraft(snapshotDate);
    setPendingDraft(null);
    setDraftSavedAt(null);
    setRows(buildInitialRows());
    setNotes("");
  }, [snapshotDate, buildInitialRows]);

  // Autosave the working state, debounced. Keyed by date so a date change
  // starts a fresh draft slot.
  useEffect(() => {
    if (!didInit.current || !rows || pendingDraft) return;
    const t = setTimeout(() => {
      const savedAt = Date.now();
      writeDraft({
        snapshotDate,
        notes,
        sourceSnapshotId: latestSnap?.snapshot.id ?? null,
        savedAt,
        rows: rows.map((r) => ({
          performanceAccountId: r.performanceAccountId,
          institution: r.institution,
          accountType: r.accountType,
          taxType: r.taxType,
          amount: r.amount,
        })),
      });
      setDraftSavedAt(savedAt);
    }, 800);
    return () => clearTimeout(t);
  }, [rows, notes, snapshotDate, latestSnap, pendingDraft]);

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
        subType: r.subType ?? null,
        label: r.label ?? null,
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

  if (loadingLatest || loadingPeople || loadingPerfAccounts) {
    return (
      <p className="text-muted text-sm">Loading latest snapshot data...</p>
    );
  }

  return (
    <div className="space-y-4">
      {pendingDraft && (
        <div className="flex items-center justify-between rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <span>
            You have an unsaved draft for {pendingDraft.snapshotDate} from{" "}
            {new Date(pendingDraft.savedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={resumeDraft}
              className="font-semibold text-blue-700 hover:underline"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="text-blue-600 hover:underline"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {/* Date + notes */}
      <div className="flex items-end gap-4">
        <div>
          <label className="text-muted mb-1 block text-xs font-medium">
            Snapshot Date
          </label>
          <input
            type="date"
            value={snapshotDate}
            onChange={(e) => setSnapshotDate(e.target.value)}
            className="border-strong rounded border px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-muted mb-1 block text-xs font-medium">
            Notes (optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Monthly snapshot"
            className="border-strong w-full rounded border px-2 py-1 text-sm"
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
                  <div className="border-strong flex items-center gap-3 border-b-2 py-1.5">
                    <span className="text-primary flex-1 text-sm font-bold">
                      {institution}
                    </span>
                    <span className="text-primary text-sm font-bold tabular-nums">
                      {formatCurrency(instTotal)}
                    </span>
                    {instPrev > 0 && instDelta !== 0 && (
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                          instDelta > 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {instDelta > 0 ? (
                          <TrendingUp className="h-3 w-3 flex-shrink-0" />
                        ) : (
                          <TrendingDown className="h-3 w-3 flex-shrink-0" />
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
                        <div className="border-strong flex items-center gap-3 border-b py-1 pl-3">
                          <span className="text-primary flex-1 text-xs font-semibold">
                            {group.perfName}
                          </span>
                          <span className="text-primary text-xs font-semibold tabular-nums">
                            {formatCurrency(groupTotal)}
                          </span>
                          {groupPrev > 0 && groupDelta !== 0 && (
                            <span
                              className={`text-caption inline-flex items-center gap-0.5 font-medium tabular-nums ${
                                groupDelta > 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {groupDelta > 0 ? (
                                <TrendingUp className="h-3 w-3 flex-shrink-0" />
                              ) : (
                                <TrendingDown className="h-3 w-3 flex-shrink-0" />
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
                              className="border-subtle flex items-center gap-3 border-b py-1.5 pl-6"
                            >
                              <span className="text-muted flex-1 text-xs">
                                {row.subLabel}
                                {row.isClosedAccount && (
                                  <span className="text-micro bg-surface-strong text-muted ml-1.5 rounded px-1 py-0.5 font-semibold">
                                    CLOSED
                                  </span>
                                )}
                              </span>
                              <div className="flex flex-col items-end gap-0.5">
                                <div
                                  className={`border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500 ${row.isClosedAccount ? "opacity-50" : ""}`}
                                  title={
                                    row.isClosedAccount
                                      ? "This account is closed — its balance is always recorded as $0"
                                      : undefined
                                  }
                                >
                                  <span className="text-muted pl-1.5 text-xs select-none">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.amount}
                                    disabled={row.isClosedAccount}
                                    onChange={(e) =>
                                      updateRow(
                                        row.key,
                                        "amount",
                                        e.target.value,
                                      )
                                    }
                                    className="text-primary focus-visible:ring-offset-surface-primary w-28 rounded bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
                                  />
                                </div>
                                {row.isClosedAccount ? null : row.previousAmount ===
                                  0 ? (
                                  <span className="text-caption bg-surface-sunken text-faint rounded px-1 py-0.5 font-medium">
                                    new
                                  </span>
                                ) : changed ? (
                                  <span className="text-caption text-faint tabular-nums">
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
        <div className="border-strong mt-2 flex items-center gap-3 border-t-2 py-2">
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
                <TrendingUp className="h-3 w-3 flex-shrink-0" />
              ) : (
                <TrendingDown className="h-3 w-3 flex-shrink-0" />
              )}
              {formatCurrency(Math.abs(totalDelta))}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {draftSavedAt != null && (
          <span className="text-faint text-xs">
            Draft saved on this device ·{" "}
            {new Date(draftSavedAt).toLocaleTimeString(undefined, {
              timeStyle: "short",
            })}
          </span>
        )}
        <div className="flex-1" />
        {draftSavedAt != null && (
          <button
            type="button"
            onClick={discardDraft}
            className="text-muted px-2 py-1.5 text-sm hover:text-red-600"
          >
            Discard draft
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-primary border-strong rounded border px-3 py-1.5 text-sm"
        >
          Close
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={createMutation.isPending || currentRows.length === 0}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
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
