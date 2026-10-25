"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { accountDisplayName } from "@/lib/utils/format";
import { describeCheck, PERF_FIELD_HELP } from "@/lib/config/performance-help";
import {
  PERF_FIELDS,
  PERF_NOTE_MAX,
  type PerfField,
} from "@/lib/pure/performance-annotations";
import type { PerfCheckKind } from "@/lib/pure/performance-checks";
import type { AccountRow } from "./types";

/**
 * One Performance account-year: the household's note, which figures are
 * still estimates, and each reconciliation gap — fix it in the table, or
 * accept it with a reason when it's on purpose.
 */
export function AccountNotesDialog({
  account,
  onClose,
  onChanged,
}: {
  /** Kept fresh by the page (looked up by id), so accepting updates it. */
  account: AccountRow;
  onClose: () => void;
  /** Called after any change — the page refreshes its data. */
  onChanged: () => void;
}) {
  const [note, setNote] = useState(account.note ?? "");
  const [estimated, setEstimated] = useState<Set<PerfField>>(
    () => new Set(account.estimatedFields ?? []),
  );
  const [reasons, setReasons] = useState<
    Partial<Record<PerfCheckKind, string>>
  >({});
  const annotate = trpc.performance.annotateAccount.useMutation({
    onSuccess: onChanged,
  });
  const name = accountDisplayName({
    ...account,
    accountType: account.accountType ?? undefined,
  });
  const checks = account.checks ?? [];
  const accepted = account.acceptedChecks ?? {};

  const toggle = (f: PerfField) =>
    setEstimated((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

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
        aria-label={`${name} ${account.year}: notes and checks`}
        className="bg-surface-primary mx-4 max-h-[85vh] w-full max-w-xl overflow-auto rounded-lg border p-5 shadow-xl"
      >
        <h2 className="text-primary text-lg font-semibold">
          {name} — {account.year}
        </h2>

        {checks.length > 0 && (
          <section className="mt-4">
            <h3 className="text-primary text-sm font-semibold">
              Figures that don&apos;t fit together
            </h3>
            <ul className="mt-2 space-y-3">
              {checks.map((c) => {
                const d = describeCheck(c);
                const acc = accepted[c.kind];
                return (
                  <li key={c.kind} className="text-sm">
                    <div className="font-medium">{d.title}</div>
                    <p className="text-muted text-xs">{d.help}</p>
                    {c.accepted && acc ? (
                      <p className="text-muted mt-1 text-xs">
                        Accepted {acc.on}: “{acc.note}”{" "}
                        <button
                          type="button"
                          className="text-blue-600 underline hover:text-blue-800"
                          disabled={annotate.isPending}
                          onClick={() =>
                            annotate.mutate({
                              id: account.id,
                              unaccept: c.kind,
                            })
                          }
                        >
                          Un-accept
                        </button>
                      </p>
                    ) : (
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          value={reasons[c.kind] ?? ""}
                          maxLength={280}
                          placeholder="Why it's on purpose (e.g. provider's reported gain)"
                          aria-label={`Reason to accept: ${d.title}`}
                          onChange={(e) =>
                            setReasons((r) => ({
                              ...r,
                              [c.kind]: e.target.value,
                            }))
                          }
                          className="border-default min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={
                            annotate.isPending || !reasons[c.kind]?.trim()
                          }
                          onClick={() =>
                            annotate.mutate({
                              id: account.id,
                              accept: {
                                kind: c.kind,
                                note: reasons[c.kind]!.trim(),
                              },
                            })
                          }
                          className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          Accept
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-4">
          <h3 className="text-primary text-sm font-semibold">
            Still estimated
          </h3>
          <p className="text-muted text-xs">
            Mark figures to confirm against a statement later — Finalize lists
            them. Un-mark one once it&apos;s confirmed.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERF_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={estimated.has(f)}
                onClick={() => toggle(f)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  estimated.has(f)
                    ? "border-amber-400 bg-amber-100 text-amber-800"
                    : "border-default text-muted"
                }`}
              >
                {PERF_FIELD_HELP[f].label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <label
            htmlFor="perf-note"
            className="text-primary text-sm font-semibold"
          >
            Note
          </label>
          <textarea
            id="perf-note"
            value={note}
            maxLength={PERF_NOTE_MAX}
            rows={3}
            placeholder="Where these figures came from, anything to check at year end"
            onChange={(e) => setNote(e.target.value)}
            className="border-default mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </section>

        {annotate.isError && (
          <p className="mt-2 text-sm text-red-600">{annotate.error.message}</p>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-primary border-strong rounded border px-3 py-1.5 text-sm"
          >
            Close
          </button>
          <button
            type="button"
            disabled={annotate.isPending}
            onClick={() =>
              annotate.mutate(
                {
                  id: account.id,
                  note,
                  estimatedFields: PERF_FIELDS.filter((f) => estimated.has(f)),
                },
                { onSuccess: onClose },
              )
            }
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save note &amp; estimates
          </button>
        </div>
      </div>
    </div>
  );
}
