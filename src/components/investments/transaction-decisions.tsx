"use client";

/**
 * The few SimpleFIN transactions a fill needs a decision on, asked where
 * the numbers are made (Update Performance / Update Basis): rows no rule
 * could place, and deposits or withdrawals that look like a move between
 * the household's accounts. One plain question per row; "always" turns the
 * answer into a rule for rows like it. Renders nothing when there's
 * nothing to decide (or without the portfolio permission it needs).
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { INVESTMENT_TRANSACTION_KIND_LABELS } from "@/lib/config/display-labels";
import type { InvestmentTransactionKind } from "@/lib/config/enum-values";

type Decision = RouterOutputs["investments"]["listDecisions"][number];

const CHOICES_IN: { kind: InvestmentTransactionKind; label: string }[] = [
  { kind: "contribution", label: "New money in" },
  { kind: "transfer", label: "Moved between my accounts" },
  { kind: "other", label: "Not money in or out" },
];
const CHOICES_OUT: { kind: InvestmentTransactionKind; label: string }[] = [
  { kind: "withdrawal", label: "Taken out" },
  { kind: "transfer", label: "Moved between my accounts" },
  { kind: "fee", label: "Fee" },
  { kind: "other", label: "Not money in or out" },
];

function why(d: Decision): string {
  const s = d.transferSuggestion;
  if (s?.reason === "pair")
    return `Matches ${formatCurrency(-d.amount)} in ${s.other} on ${formatDate(s.otherPosted!, "medium")} — looks like money moved between your accounts.`;
  if (s?.reason === "recorded")
    return `Your Performance figures already record money moving in from ${s.other} this year — this is probably part of it (counting it as new money too would count it twice).`;
  if (s?.reason === "words")
    return "The description says it's a transfer or rollover.";
  return d.kind === "other"
    ? "Ledgr couldn't tell what this is."
    : `Ledgr's guess: ${INVESTMENT_TRANSACTION_KIND_LABELS[d.kind]} — check it.`;
}

function DecisionRow({ d }: { d: Decision }) {
  const utils = trpc.useUtils();
  const [always, setAlways] = useState(false);
  const refresh = () => utils.investments.invalidate();
  const setKind = trpc.investments.setTransactionKind.useMutation({
    onSuccess: refresh,
  });
  const createRule = trpc.investments.createRule.useMutation({
    onSuccess: refresh,
  });
  const choices = d.amount > 0 ? CHOICES_IN : CHOICES_OUT;
  const suggested = d.transferSuggestion ? "transfer" : d.kind;
  const busy = setKind.isPending || createRule.isPending;
  const decide = (kind: InvestmentTransactionKind) => {
    if (always)
      createRule.mutate({
        institutionContains: d.institution,
        descriptionContains: d.description,
        sign: d.amount > 0 ? "positive" : "negative",
        kind,
        fromTransactionId: d.id,
      });
    setKind.mutate({ id: d.id, kind });
  };
  return (
    <li className="border-subtle border-b py-2 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span>
          <span className="text-faint">{formatDate(d.posted, "medium")}</span>{" "}
          <span className="text-primary">{d.description}</span>{" "}
          <span className="text-faint">
            · {d.institution} {d.accountName}
          </span>
        </span>
        <span className="text-primary font-medium tabular-nums">
          {formatCurrency(d.amount)}
        </span>
      </div>
      <p className="text-caption text-muted mt-0.5">{why(d)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {choices.map((c) => (
          <button
            key={c.kind}
            type="button"
            disabled={busy}
            onClick={() => decide(c.kind)}
            className={`rounded border px-2 py-0.5 text-xs ${
              c.kind === suggested
                ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                : "border-default text-secondary hover:bg-surface-elevated"
            }`}
          >
            {c.label}
          </button>
        ))}
        <label className="text-caption text-faint ml-1 inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
          />
          always treat &ldquo;{d.description}&rdquo; at {d.institution} this way
        </label>
      </div>
      {(setKind.isError || createRule.isError) && (
        <p className="text-caption text-red-600">
          {(setKind.error ?? createRule.error)?.message}
        </p>
      )}
    </li>
  );
}

export function TransactionDecisions({ year }: { year: number }) {
  const { data } = trpc.investments.listDecisions.useQuery(
    { year },
    { retry: false },
  );
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-900/20">
      <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
        Before filling: {data.length} transaction
        {data.length === 1 ? " needs" : "s need"} a decision
      </p>
      <p className="text-caption text-amber-800 dark:text-amber-400">
        These change the figures below. Undecided ones count as Ledgr&apos;s
        guess.
      </p>
      <ul className="mt-1">
        {data.map((d) => (
          <DecisionRow key={d.id} d={d} />
        ))}
      </ul>
    </div>
  );
}
