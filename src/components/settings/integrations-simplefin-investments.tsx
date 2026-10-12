"use client";

/**
 * Settings → SimpleFIN → Investment data: what the daily sync collected
 * (holdings, recent activity) and the review queue for rows no rule could
 * place, with "save as a rule" for the household's own institutions.
 * Needs the portfolio permission (mounted on the admin-only Integrations page).
 */
import { localDateStr } from "@/lib/utils/date";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  isPrivacyMode,
  maskAmountsInText,
} from "@/lib/utils/format";
import { INVESTMENT_TRANSACTION_KIND_LABELS } from "@/lib/config/display-labels";
import {
  INVESTMENT_TRANSACTION_KIND_VALUES,
  type InvestmentTransactionKind,
} from "@/lib/config/enum-values";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { TickerLink } from "@/components/investments/ticker-link";
import { safeDivide } from "@/lib/utils/math";

const KIND_OPTIONS = INVESTMENT_TRANSACTION_KIND_VALUES.map((k) => ({
  value: k,
  label: INVESTMENT_TRANSACTION_KIND_LABELS[k],
}));

const SOURCE_LABELS = {
  override: "set by you",
  locked: "medical withdrawal",
  user_rule: "your rule",
  built_in: "",
  unmatched: "",
  transfer_match: "matched to another of your accounts",
} as const;

const selectClass =
  "text-caption border-strong bg-surface-primary text-primary rounded border px-1.5 py-0.5";
const inputClass =
  "border-strong bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs";

function KindSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: InvestmentTransactionKind | "";
  onChange: (kind: InvestmentTransactionKind) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as InvestmentTransactionKind)}
      className={selectClass}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {KIND_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type QueueRow = {
  id: number;
  institution: string;
  accountName: string;
  posted: string;
  rawAmount: number;
  description: string;
};

function RuleForm({ from, onDone }: { from: QueueRow; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [institutionContains, setInstitution] = useState(from.institution);
  const [descriptionContains, setDescription] = useState(from.description);
  const [kind, setKind] = useState<InvestmentTransactionKind | "">("");
  const draft = useDebouncedValue(
    { institutionContains, descriptionContains, kind },
    300,
  );
  const ready =
    draft.institutionContains.trim() !== "" &&
    draft.descriptionContains.trim() !== "" &&
    draft.kind !== "";
  const { data: preview } = trpc.investments.previewRule.useQuery(
    {
      institutionContains: draft.institutionContains,
      descriptionContains: draft.descriptionContains,
      kind: (draft.kind || "other") as InvestmentTransactionKind,
    },
    { enabled: ready },
  );
  const create = trpc.investments.createRule.useMutation({
    onSuccess: () => {
      utils.investments.invalidate();
      onDone();
    },
  });

  return (
    <div className="bg-surface-elevated mt-2 space-y-2 rounded p-3">
      <p className="text-caption text-muted">
        Rows from an institution containing
      </p>
      <input
        value={institutionContains}
        onChange={(e) => setInstitution(e.target.value)}
        className={inputClass}
        aria-label="Institution contains"
      />
      <p className="text-caption text-muted">with a description containing</p>
      <input
        value={descriptionContains}
        onChange={(e) => setDescription(e.target.value)}
        className={inputClass}
        aria-label="Description contains"
      />
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted">are</span>
        <KindSelect value={kind} onChange={setKind} placeholder="Choose…" />
      </div>
      {ready && preview && (
        <p className="text-caption text-faint">
          {preview.matched === 0
            ? "Matches no stored rows yet."
            : `Matches ${preview.matched} stored ${preview.matched === 1 ? "row" : "rows"}; reclassifies ${preview.changed}.`}{" "}
          Rows you set by hand keep their choice.
        </p>
      )}
      {create.isError && (
        <p className="text-caption text-red-600">{create.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="primary"
          disabled={!ready || create.isPending}
          onClick={() =>
            create.mutate({
              institutionContains,
              descriptionContains,
              kind: kind as InvestmentTransactionKind,
              fromTransactionId: from.id,
            })
          }
        >
          Save rule
        </Button>
        <Button size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReviewQueue() {
  const utils = trpc.useUtils();
  const { data: queue } = trpc.investments.listReviewQueue.useQuery();
  const [ruleFrom, setRuleFrom] = useState<number | null>(null);
  const setKind = trpc.investments.setTransactionKind.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  if (!queue) return null;
  if (queue.length === 0)
    return (
      <p className="text-caption text-faint">
        Nothing to review — every row is classified.
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-caption text-faint">
        These rows didn&apos;t match a known format. Set what each one is, or
        save a rule so future rows like it are placed automatically. Withdrawals
        from an HSA are stored as &ldquo;Medical withdrawal&rdquo; with the
        amount only.
      </p>
      {setKind.isError && (
        <p className="text-caption text-red-600">{setKind.error.message}</p>
      )}
      {queue.map((r) => (
        <div key={r.id} className="border-subtle border-b pb-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-primary min-w-0 truncate">
              {maskAmountsInText(r.description)}
            </span>
            <span className="text-muted shrink-0">
              {formatCurrency(r.rawAmount)}
            </span>
          </div>
          <div className="text-caption text-faint flex flex-wrap items-center gap-2">
            <span>
              {formatDate(r.posted, "medium")} · {r.institution} {r.accountName}
            </span>
            <KindSelect
              value=""
              placeholder="Set kind…"
              disabled={setKind.isPending}
              onChange={(kind) => setKind.mutate({ id: r.id, kind })}
            />
            <button
              className="hover:text-primary underline"
              onClick={() => setRuleFrom(ruleFrom === r.id ? null : r.id)}
            >
              Save as a rule…
            </button>
          </div>
          {ruleFrom === r.id && (
            <RuleForm from={r} onDone={() => setRuleFrom(null)} />
          )}
        </div>
      ))}
    </div>
  );
}

function Holdings() {
  const { data: holdings } = trpc.investments.listHoldings.useQuery();
  if (!holdings) return null;
  if (holdings.length === 0)
    return (
      <p className="text-caption text-faint">
        No holdings reported yet. They appear after the next sync for
        institutions that send them.
      </p>
    );
  const privacy = isPrivacyMode();
  // By account id: two accounts at one institution can share a name.
  const groups = new Map<number, typeof holdings>();
  for (const h of holdings) {
    groups.set(h.simplefinAccountId, [
      ...(groups.get(h.simplefinAccountId) ?? []),
      h,
    ]);
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-xs tabular-nums">
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="text-faint border-subtle border-b text-left">
            <th className="py-1 pr-2 font-medium">Fund</th>
            <th className="py-1 pr-2 text-right font-medium">Shares</th>
            <th className="py-1 pr-2 text-right font-medium">Value</th>
            <th className="py-1 text-right font-medium">Of account</th>
          </tr>
        </thead>
        {[...groups.entries()].map(([accountId, rows]) => {
          const total = rows.reduce(
            (t, h) => t + (h.reportedMarketValue ?? 0),
            0,
          );
          return (
            <tbody key={accountId}>
              <tr>
                <td
                  colSpan={2}
                  className="text-primary pt-3 pr-2 pb-1 font-medium"
                >
                  {`${rows[0]!.institution} ${rows[0]!.accountName}`.trim()}
                  <span className="text-faint font-normal">
                    {" "}
                    · as of {formatDate(rows[0]!.asOf, "medium")}
                  </span>
                </td>
                <td className="text-primary pt-3 pr-2 pb-1 text-right font-medium whitespace-nowrap">
                  {formatCurrency(total)}
                </td>
                <td />
              </tr>
              {rows.map((h) => {
                return (
                  <tr
                    key={`${h.symbol}-${h.name}`}
                    className="border-subtle border-b last:border-b-0"
                  >
                    <td className="py-1 pr-2 pl-3">
                      {h.symbol && <TickerLink symbol={h.symbol} />}
                      <span className="text-muted">{h.name}</span>
                    </td>
                    <td className="text-muted py-1 pr-2 text-right whitespace-nowrap">
                      {privacy ? "••••" : formatNumber(h.shares, 3)}
                    </td>
                    <td className="text-primary py-1 pr-2 text-right whitespace-nowrap">
                      {h.reportedMarketValue === null
                        ? "—"
                        : formatCurrency(h.reportedMarketValue)}
                    </td>
                    <td className="text-faint py-1 text-right whitespace-nowrap">
                      {h.reportedMarketValue === null || total <= 0
                        ? "—"
                        : formatPercent(
                            safeDivide(h.reportedMarketValue, total),
                            0,
                          )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function RecentActivity() {
  const utils = trpc.useUtils();
  // The last 30 days, plus older rows (back to SimpleFIN's ~90) that look
  // like a move between accounts and still need a decision.
  const { data: all } = trpc.investments.listTransactions.useQuery({
    days: 90,
  });
  const [cutoff] = useState(() =>
    localDateStr(new Date(Date.now() - 30 * 86_400_000)),
  );
  const rows = all?.filter(
    (r) => r.posted >= cutoff || r.transferSuggestion !== null,
  );
  const clear = trpc.investments.clearTransactionKind.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const markTransfer = trpc.investments.setTransactionKind.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  if (!rows) return null;
  if (rows.length === 0)
    return (
      <p className="text-caption text-faint">
        No activity in the last 30 days.
      </p>
    );
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-subtle border-b align-top">
            <td className="text-faint py-1 pr-2 whitespace-nowrap">
              {formatDate(r.posted, "medium")}
            </td>
            <td className="py-1 pr-2">
              <span className="text-primary">
                {maskAmountsInText(r.description)}
              </span>
              <span className="text-faint block">
                {r.institution} {r.accountName}
                {r.pending && " · pending"}
              </span>
            </td>
            <td className="py-1 pr-2 whitespace-nowrap">
              <span className={r.needsReview ? "text-amber-600" : "text-muted"}>
                {r.transfer?.conversion
                  ? "Conversion Traditional → Roth"
                  : INVESTMENT_TRANSACTION_KIND_LABELS[r.kind]}
              </span>
              {SOURCE_LABELS[r.source] && (
                <span className="text-faint block">
                  {SOURCE_LABELS[r.source]}
                  {r.source === "override" && (
                    <button
                      className="hover:text-primary ml-1 underline"
                      onClick={() => clear.mutate({ id: r.id })}
                      disabled={clear.isPending}
                    >
                      undo
                    </button>
                  )}
                </span>
              )}
              {(r.kind === "contribution" || r.kind === "withdrawal") &&
                r.source !== "locked" &&
                !r.pending && (
                  <span
                    className={`block ${r.transferSuggestion ? "text-amber-700 dark:text-amber-400" : "text-faint"}`}
                  >
                    {r.transferSuggestion?.reason === "pair" &&
                      `Matches ${formatCurrency(-r.amount)} in ${r.transferSuggestion.other} on ${formatDate(r.transferSuggestion.otherPosted!, "medium")} — looks like a move between your accounts. `}
                    {r.transferSuggestion?.reason === "recorded" &&
                      `Your Performance figures already record money moving in from ${r.transferSuggestion.other} this year — this deposit may be part of that move (counting it as a deposit too would count it twice). `}
                    {r.transferSuggestion?.reason === "words" &&
                      "The description says it's a transfer or rollover. "}
                    <button
                      className="hover:text-primary underline"
                      disabled={markTransfer.isPending}
                      onClick={() =>
                        markTransfer.mutate({ id: r.id, kind: "transfer" })
                      }
                    >
                      {r.transferSuggestion
                        ? "Mark as a transfer"
                        : "moved between my accounts?"}
                    </button>
                  </span>
                )}
              {r.kind === "contribution" && r.amount > 0 && !r.pending && (
                <DepositSplit
                  id={r.id}
                  amount={r.amount}
                  split={r.sourceSplit}
                />
              )}
            </td>
            <td className="text-primary py-1 text-right whitespace-nowrap">
              {formatCurrency(r.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A deposit's split by hand: employer and employee-Roth dollars (the rest
 * is the employee's other money). Fills use it instead of estimating the
 * split from the paycheck setup.
 */
function DepositSplit({
  id,
  amount,
  split,
}: {
  id: number;
  amount: number;
  split: { employer: number; employeeRoth: number } | null;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [employer, setEmployer] = useState(String(split?.employer ?? ""));
  const [roth, setRoth] = useState(String(split?.employeeRoth ?? ""));
  const save = trpc.investments.setTransactionSplit.useMutation({
    onSuccess: () => {
      setOpen(false);
      void utils.investments.invalidate();
    },
  });
  if (!open)
    return (
      <span className="text-faint block">
        {split
          ? `split by you: employer ${formatCurrency(split.employer)}, Roth ${formatCurrency(split.employeeRoth)}`
          : "split estimated from your paycheck setup"}{" "}
        <button
          className="hover:text-primary underline"
          onClick={() => setOpen(true)}
        >
          {split ? "change" : "split"}
        </button>
      </span>
    );
  const e = Number(employer) || 0;
  const r = Number(roth) || 0;
  const over = e + r > amount + 0.005;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <label className="text-faint">
        Employer $
        <input
          type="number"
          step="0.01"
          min="0"
          value={employer}
          onChange={(ev) => setEmployer(ev.target.value)}
          aria-label="Employer part"
          className="border-default ml-0.5 w-20 rounded border px-1"
        />
      </label>
      <label className="text-faint">
        Your Roth $
        <input
          type="number"
          step="0.01"
          min="0"
          value={roth}
          onChange={(ev) => setRoth(ev.target.value)}
          aria-label="Your Roth part"
          className="border-default ml-0.5 w-20 rounded border px-1"
        />
      </label>
      <span className="text-faint">
        rest yours: {formatCurrency(Math.max(0, amount - e - r))}
      </span>
      <Button
        size="xs"
        variant="primary"
        disabled={save.isPending || over}
        onClick={() =>
          save.mutate({ id, split: { employer: e, employeeRoth: r } })
        }
      >
        Save
      </Button>
      {split && (
        <Button
          size="xs"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => save.mutate({ id, split: null })}
        >
          Clear
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {over && <span className="text-red-600">More than the deposit.</span>}
      {save.isError && (
        <span className="text-red-600">{save.error.message}</span>
      )}
    </span>
  );
}

function Rules() {
  const utils = trpc.useUtils();
  const { data: rules } = trpc.investments.listRules.useQuery();
  const remove = trpc.investments.deleteRule.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  if (!rules || rules.length === 0)
    return (
      <p className="text-caption text-faint">
        No rules yet. Save one from a row in the review queue.
      </p>
    );
  return (
    <ul className="space-y-1 text-xs">
      {rules.map((r) => (
        <li key={r.id} className="flex items-baseline justify-between gap-2">
          <span className="text-muted">
            <span className="text-primary">{r.institutionContains}</span> rows
            containing{" "}
            <span className="text-primary">
              &ldquo;{r.descriptionContains}&rdquo;
            </span>{" "}
            are{" "}
            <span className="text-primary">
              {INVESTMENT_TRANSACTION_KIND_LABELS[r.kind]}
            </span>
          </span>
          <button
            className="text-faint shrink-0 hover:text-red-600"
            onClick={() => {
              if (
                confirm(
                  "Delete this rule? Matching rows go back to the built-in rules.",
                )
              )
                remove.mutate({ id: r.id });
            }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

const TABS = [
  { key: "review", label: "Needs review" },
  { key: "holdings", label: "Holdings" },
  { key: "activity", label: "Recent activity" },
  { key: "rules", label: "Your rules" },
] as const;

export function SimplefinInvestmentsCard() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("review");
  const { data: queue } = trpc.investments.listReviewQueue.useQuery();
  return (
    <Card title="Investment data">
      <p className="text-muted mb-3 text-xs">
        Holdings and investment-account activity collected by the daily sync.
        SimpleFIN only keeps about 90 days, so Ledgr stores them as they arrive.
        Checking and credit-card activity is never stored.
      </p>
      <div className="border-subtle mb-3 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs ${tab === t.key ? "text-primary border-blue-600" : "text-muted border-transparent"}`}
          >
            {t.label}
            {t.key === "review" && queue && queue.length > 0 && (
              <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === "review" && <ReviewQueue />}
      {tab === "holdings" && <Holdings />}
      {tab === "activity" && <RecentActivity />}
      {tab === "rules" && <Rules />}
    </Card>
  );
}
