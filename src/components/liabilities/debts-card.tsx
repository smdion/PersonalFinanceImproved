"use client";

/**
 * Liabilities ▸ Other debts: every debt besides the mortgage — student and
 * car loans, cards carried month to month, personal and medical debt —
 * with its rate, monthly payment and payoff estimate; paid-off debts kept
 * below as history. Balances are as entered (with the date they're as of),
 * never moved forward on their own. The typed "other debts, not itemized"
 * figure and mapped credit cards are shown alongside (server/helpers/
 * debts.ts sums all three).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { localDateStr } from "@/lib/utils/date";
import { DEBT_KIND_CONFIG } from "@/lib/config/debts";
import { DEBT_KIND_VALUES, type DebtKind } from "@/lib/config/enum-values";

type Draft = {
  name: string;
  kind: DebtKind;
  ownerPersonId: string;
  balance: string;
  balanceAsOf: string;
  ratePct: string;
  monthlyPayment: string;
  originalAmount: string;
  openedDate: string;
  paidOffDate: string;
  notes: string;
};

const blank = (): Draft => ({
  name: "",
  kind: "student_loan",
  ownerPersonId: "",
  balance: "",
  balanceAsOf: localDateStr(),
  ratePct: "",
  monthlyPayment: "",
  originalAmount: "",
  openedDate: "",
  paidOffDate: "",
  notes: "",
});

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
};

export function DebtsCard() {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data: debts } = trpc.debts.list.useQuery();
  const { data: summary } = trpc.debts.summary.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();
  const done = () => {
    utils.debts.invalidate();
    utils.networth.invalidate();
    utils.milestones.invalidate();
  };
  const create = trpc.debts.create.useMutation({ onSuccess: done });
  const update = trpc.debts.update.useMutation({ onSuccess: done });
  const markPaidOff = trpc.debts.markPaidOff.useMutation({ onSuccess: done });
  const remove = trpc.debts.delete.useMutation({ onSuccess: done });

  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [showPaid, setShowPaid] = useState(false);
  const set = (k: keyof Draft) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const open = debts?.filter((d) => d.open) ?? [];
  const paid = debts?.filter((d) => !d.open) ?? [];
  const ownerName = (id: number | null) =>
    id == null ? "Joint" : (people?.find((p) => p.id === id)?.name ?? "—");

  const save = () => {
    const toNum = (v: string) => (v.trim() === "" ? null : v.trim());
    const rate =
      draft.ratePct.trim() === "" ? null : String(Number(draft.ratePct) / 100);
    const fields = {
      name: draft.name.trim(),
      kind: draft.kind,
      ownerPersonId: draft.ownerPersonId ? Number(draft.ownerPersonId) : null,
      balance: draft.balance.trim() || "0",
      balanceAsOf: draft.balanceAsOf,
      interestRate: rate,
      monthlyPayment: toNum(draft.monthlyPayment),
      originalAmount: toNum(draft.originalAmount),
      openedDate: draft.openedDate || null,
      paidOffDate: draft.paidOffDate || null,
      notes: draft.notes.trim() || null,
    };
    const after = { onSuccess: () => setEditing(null) };
    if (editing === "new") create.mutate(fields, after);
    else if (editing !== null) update.mutate({ id: editing, ...fields }, after);
  };
  const startEdit = (d: NonNullable<typeof debts>[number]) => {
    setEditing(d.id);
    setDraft({
      name: d.name,
      kind: d.kind,
      ownerPersonId: d.ownerPersonId ? String(d.ownerPersonId) : "",
      balance: String(d.balance),
      balanceAsOf: d.balanceAsOf,
      ratePct:
        d.interestRate == null
          ? ""
          : String(+(d.interestRate * 100).toFixed(4)),
      monthlyPayment: d.monthlyPayment == null ? "" : String(d.monthlyPayment),
      originalAmount: d.originalAmount == null ? "" : String(d.originalAmount),
      openedDate: d.openedDate ?? "",
      paidOffDate: d.paidOffDate ?? "",
      notes: d.notes ?? "",
    });
  };
  const error = create.error ?? update.error;

  const input = "border-strong rounded border px-2 py-1 text-sm bg-transparent";
  const form = (
    <div className="bg-surface-sunken mb-3 grid gap-2 rounded p-3 text-sm sm:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Name</span>
        <input
          className={input}
          value={draft.name}
          onChange={(e) => set("name")(e.target.value)}
          placeholder="e.g. Nelnet"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Kind</span>
        <select
          className={input}
          value={draft.kind}
          onChange={(e) => set("kind")(e.target.value)}
        >
          {DEBT_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {DEBT_KIND_CONFIG[k].label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Owner</span>
        <select
          className={input}
          value={draft.ownerPersonId}
          onChange={(e) => set("ownerPersonId")(e.target.value)}
        >
          <option value="">Joint</option>
          {people?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Balance</span>
        <input
          className={input}
          type="number"
          min={0}
          step="0.01"
          value={draft.balance}
          onChange={(e) => set("balance")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Balance as of</span>
        <input
          className={input}
          type="date"
          value={draft.balanceAsOf}
          onChange={(e) => set("balanceAsOf")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Interest rate (%)</span>
        <input
          className={input}
          type="number"
          min={0}
          max={99}
          step="0.01"
          value={draft.ratePct}
          onChange={(e) => set("ratePct")(e.target.value)}
          placeholder="e.g. 6.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">You pay each month</span>
        <input
          className={input}
          type="number"
          min={0}
          step="0.01"
          value={draft.monthlyPayment}
          onChange={(e) => set("monthlyPayment")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Original amount</span>
        <input
          className={input}
          type="number"
          min={0}
          step="0.01"
          value={draft.originalAmount}
          onChange={(e) => set("originalAmount")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">Opened</span>
        <input
          className={input}
          type="date"
          value={draft.openedDate}
          onChange={(e) => set("openedDate")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">
          Paid off (leave empty if still owed)
        </span>
        <input
          className={input}
          type="date"
          value={draft.paidOffDate}
          onChange={(e) => set("paidOffDate")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-muted text-xs">Notes</span>
        <input
          className={input}
          value={draft.notes}
          onChange={(e) => set("notes")(e.target.value)}
        />
      </label>
      {draft.kind === "credit_card" && (summary?.creditCardMapped ?? 0) > 0 && (
        <p className="text-xs text-amber-700 sm:col-span-3 dark:text-amber-400">
          Credit-card balances already come from your budget. List a card here
          only for a balance you carry month to month, and only if it isn&apos;t
          one of those mapped cards — otherwise it&apos;s counted twice.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 sm:col-span-3">{error.message}</p>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button
          variant="primary"
          size="sm"
          disabled={!draft.name.trim() || create.isPending || update.isPending}
          onClick={save}
        >
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
          Cancel
        </Button>
        {typeof editing === "number" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-red-600"
            onClick={() => {
              if (
                confirm(
                  `Delete ${draft.name}? Mark it paid off instead to keep it as history.`,
                )
              )
                remove.mutate(
                  { id: editing },
                  { onSuccess: () => setEditing(null) },
                );
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card
      title="Other debts"
      headerRight={
        admin && editing === null ? (
          <button
            onClick={() => {
              setDraft(blank());
              setEditing("new");
            }}
            className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong rounded px-2 py-1 font-medium"
          >
            + Add debt
          </button>
        ) : null
      }
    >
      {editing === "new" && form}
      {open.length === 0 && editing !== "new" ? (
        <p className="text-faint text-sm">
          No debts listed. Add student or car loans, cards you carry a balance
          on, and other debts — with a rate and what you pay each month, Ledgr
          judges them against Money Guy&apos;s high-interest line and estimates
          when they&apos;re paid off.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-faint text-left text-xs">
              <th className="py-1 font-medium">Debt</th>
              <th className="py-1 text-right font-medium">Balance</th>
              <th className="py-1 text-right font-medium">Rate</th>
              <th className="py-1 text-right font-medium">Per month</th>
              <th className="py-1 text-right font-medium">Paid off</th>
            </tr>
          </thead>
          <tbody>
            {open.map((d) =>
              editing === d.id ? (
                <tr key={d.id}>
                  <td colSpan={5}>{form}</td>
                </tr>
              ) : (
                <tr
                  key={d.id}
                  className={`border-subtle border-t ${admin ? "hover:bg-surface-sunken cursor-pointer" : ""}`}
                  onClick={() => admin && startEdit(d)}
                >
                  <td className="py-1.5">
                    {d.name}
                    <span className="text-faint ml-1.5 text-xs">
                      {DEBT_KIND_CONFIG[d.kind].label} ·{" "}
                      {ownerName(d.ownerPersonId)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCurrency(d.balance)}
                    <div className="text-faint text-[10px]">
                      as of {d.balanceAsOf}
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {d.interestRate == null
                      ? "—"
                      : formatPercent(d.interestRate, 2)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {d.monthlyPayment == null
                      ? "—"
                      : formatCurrency(d.monthlyPayment)}
                  </td>
                  <td className="py-1.5 text-right">
                    {d.never ? (
                      <span
                        className="text-amber-600"
                        title="The payment doesn't cover the interest"
                      >
                        never
                      </span>
                    ) : d.payoffMonth ? (
                      monthLabel(d.payoffMonth)
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                    {admin && (
                      <button
                        className="text-faint ml-2 text-xs hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          markPaidOff.mutate({
                            id: d.id,
                            date: localDateStr(),
                          });
                        }}
                        title="Mark paid off today"
                      >
                        ✓
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {summary && (summary.manual > 0 || summary.creditCardMapped > 0) && (
        <div className="text-muted mt-3 space-y-1 border-t pt-2 text-xs">
          {summary.manual > 0 && (
            <div className="flex justify-between">
              <span>Other debts, not itemized (set on Net Worth)</span>
              <span className="tabular-nums">
                {formatCurrency(summary.manual)}
              </span>
            </div>
          )}
          {summary.creditCardMapped > 0 && (
            <div className="flex justify-between">
              <span>Credit cards (from your budget)</span>
              <span className="tabular-nums">
                {formatCurrency(summary.creditCardMapped)}
              </span>
            </div>
          )}
        </div>
      )}

      {paid.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <button
            className="text-muted text-xs hover:underline"
            onClick={() => setShowPaid(!showPaid)}
          >
            {paid.length} paid off {showPaid ? "▾" : "▸"}
          </button>
          {showPaid && (
            <ul className="mt-1 space-y-1 text-xs">
              {paid.map((d) =>
                editing === d.id ? (
                  <li key={d.id}>{form}</li>
                ) : (
                  <li
                    key={d.id}
                    className="text-muted flex items-center justify-between"
                  >
                    <span>
                      {d.name}
                      <span className="text-faint ml-1.5">
                        {DEBT_KIND_CONFIG[d.kind].label}
                        {d.originalAmount != null &&
                          ` · ${formatCurrency(d.originalAmount)}`}
                      </span>
                    </span>
                    <span>
                      paid off {d.paidOffDate}
                      {admin && (
                        <>
                          <button
                            className="ml-2 hover:text-blue-600"
                            onClick={() => startEdit(d)}
                          >
                            edit
                          </button>
                          <button
                            className="ml-2 hover:text-red-600"
                            onClick={() => {
                              if (confirm(`Delete ${d.name}?`))
                                remove.mutate({ id: d.id });
                            }}
                          >
                            delete
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
