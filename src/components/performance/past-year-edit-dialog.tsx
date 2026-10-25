"use client";

import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  accountDisplayName,
  formatCurrency,
  formatPercent,
} from "@/lib/utils/format";
import {
  describeCheck,
  PERF_STORED_FIELD_LABELS,
} from "@/lib/config/performance-help";
import type { AccountRow } from "./types";

type Change = { field: string; from: number | null; to: number | null };

const show = (field: string, v: number | null) =>
  v == null
    ? "—"
    : field === "annualReturnPct"
      ? formatPercent(v, 2)
      : formatCurrency(v);

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className="text-muted text-xs">
      {changes.map((c) => (
        <li key={c.field}>
          {PERF_STORED_FIELD_LABELS[c.field] ?? c.field}:{" "}
          {show(c.field, c.from)} →{" "}
          <span className="text-primary">{show(c.field, c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Saving a figure in a past year: shows everything it moves before writing
 * — the row (its gain follows when it balanced), next year's beginning (if
 * it started at this ending), the year's and later years' totals — and any
 * check the edit leaves.
 */
export function PastYearEditDialog({
  account,
  field,
  value,
  onClose,
  onSaved,
}: {
  account: AccountRow;
  field: string;
  value: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chain, setChain] = useState(true);
  const preview = trpc.performance.updateAccount.useMutation();
  const save = trpc.performance.updateAccount.useMutation({
    onSuccess: onSaved,
  });
  const { mutate } = preview;
  useEffect(() => {
    mutate({
      id: account.id,
      [field]: value,
      chainNextYear: chain,
      dryRun: true,
    });
  }, [mutate, account.id, field, value, chain]);

  const p = preview.data?.preview ?? null;
  const name = accountDisplayName({
    ...account,
    accountType: account.accountType ?? undefined,
  });
  const after = p?.checks[account.id] ?? [];

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Change ${account.year}`}
        className="bg-surface-primary mx-4 max-h-[85vh] w-full max-w-xl overflow-auto rounded-lg border p-5 shadow-xl"
      >
        <h2 className="text-primary text-lg font-semibold">
          Change {name} — {account.year}
        </h2>
        {preview.isPending && !p && (
          <p className="text-muted mt-3 text-sm">Working out what changes…</p>
        )}
        {preview.isError && (
          <p className="mt-3 text-sm text-red-600">{preview.error.message}</p>
        )}
        {p && (
          <div className="mt-3 space-y-3 text-sm">
            {p.chainable && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={chain}
                  onChange={(e) => setChain(e.target.checked)}
                  className="mt-1 accent-blue-600"
                />
                <span>
                  {p.chainable.nextYear} started at this year&apos;s old ending
                  — start it at the new one too (keeps the years continuous).
                </span>
              </label>
            )}
            {p.accounts
              .filter((a) => a.changes.length > 0)
              .map((a) => (
                <div key={a.id}>
                  <div className="font-medium">
                    {a.id === account.id
                      ? `${account.year} (this row)`
                      : a.year}
                  </div>
                  <ChangeList changes={a.changes} />
                </div>
              ))}
            {p.rollups.length > 0 && (
              <div>
                <div className="font-medium">Totals that move with it</div>
                {p.rollups.map((r) => (
                  <div key={`${r.year}-${r.category}`} className="mt-1">
                    <div className="text-xs font-medium">
                      {r.year} {r.category}
                    </div>
                    <ChangeList changes={r.changes} />
                  </div>
                ))}
              </div>
            )}
            {after.filter((c) => !c.accepted).length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                After this change:{" "}
                {after
                  .filter((c) => !c.accepted)
                  .map((c) => describeCheck(c).title)
                  .join("; ")}
              </div>
            )}
          </div>
        )}
        {save.isError && (
          <p className="mt-2 text-sm text-red-600">{save.error.message}</p>
        )}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-primary border-strong rounded border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!p || save.isPending}
            onClick={() =>
              save.mutate({
                id: account.id,
                [field]: value,
                chainNextYear: chain,
              })
            }
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save change"}
          </button>
        </div>
      </div>
    </div>
  );
}
