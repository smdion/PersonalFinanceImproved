"use client";

/**
 * Holding history (Portfolio): what each account held over time. Observed
 * periods come from daily SimpleFIN holdings and are read-only; for the
 * years before them — or an account with no feed — the household enters
 * periods (funds and %). The matched-mix comparison prices these. Shows
 * fund names and percentages only — no dollars or share counts.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { FactsForm } from "./fund-holding-row";

type Data = RouterOutputs["investments"]["listHoldingPeriods"];
type Period = Data["periods"][number];
type Draft = {
  id: number | null;
  start: string;
  end: string;
  notes: string;
  rows: { key: number; securityId: number | null; pct: string }[];
};

let nextRowKey = 0;
const row = (securityId: number | null, pct = "") => ({
  key: nextRowKey++,
  securityId,
  pct,
});

const emptyDraft = (): Draft => ({
  id: null,
  start: "",
  end: "",
  notes: "",
  rows: [row(null)],
});

const BASIS_LABEL: Record<Period["basis"], string> = {
  observed: "From daily holdings",
  user: "Entered",
  inferred: "Proposed",
};

export function HoldingHistorySection() {
  const { data } = trpc.investments.listHoldingPeriods.useQuery();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!data) return null;
  const account = accountId ?? data.accounts[0]?.id ?? null;
  const periods = data.periods.filter(
    (p) => p.performanceAccountId === account,
  );

  return (
    <Card title="Holding history">
      <p className="text-caption text-faint mb-2">
        What each account held over time. Daily holdings fill this in from when
        your SimpleFIN feed started; enter the funds you held before then (from
        old statements) so comparisons can use your real mix.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">Account</span>
        <select
          value={account ?? ""}
          onChange={(e) => {
            setAccountId(Number(e.target.value));
            setDraft(null);
          }}
          className="border-strong bg-surface-primary rounded border px-2 py-1"
        >
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      {periods.length === 0 && (
        <p className="text-faint text-sm">No history for this account yet.</p>
      )}
      <div className="space-y-2">
        {periods.map((p) => (
          <PeriodRow
            key={`${p.basis}:${p.id ?? p.start}`}
            p={p}
            funds={data.funds}
            onEdit={() =>
              setDraft({
                id: p.id,
                start: p.start,
                end: p.end ?? "",
                notes:
                  "notes" in p && typeof p.notes === "string" ? p.notes : "",
                rows: Object.entries(p.weights).map(([id, w]) =>
                  row(Number(id), String(roundToCents(w * 100))),
                ),
              })
            }
          />
        ))}
      </div>

      {account !== null &&
        (draft ? (
          <PeriodForm
            accountId={account}
            draft={draft}
            setDraft={setDraft}
            funds={data.funds}
          />
        ) : (
          <Button
            size="xs"
            variant="secondary"
            className="mt-3"
            onClick={() => setDraft(emptyDraft())}
          >
            Add a period
          </Button>
        ))}
    </Card>
  );
}

function PeriodRow({
  p,
  funds,
  onEdit,
}: {
  p: Period;
  funds: Data["funds"];
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.investments.deleteHoldingPeriod.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const [factsFor, setFactsFor] = useState<number | null>(null);
  const fundById = new Map(funds.map((f) => [f.id, f]));
  return (
    <div className="border-subtle rounded border p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-primary font-medium">
          {formatDate(p.start, "medium")} –{" "}
          {p.end ? formatDate(p.end, "medium") : "now"}
        </span>
        <span className="text-faint">{BASIS_LABEL[p.basis]}</span>
        {p.basis === "user" && p.id !== null && (
          <span className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: p.id! })}
            >
              Delete
            </Button>
          </span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {Object.entries(p.weights)
          .sort((a, b) => b[1] - a[1])
          .map(([id, w]) => {
            const f = fundById.get(Number(id));
            const noMix = f?.facts && !f.facts.composition;
            return (
              <li key={id} className="text-muted">
                <div className="flex justify-between gap-2">
                  <span className="truncate">
                    {f?.label ?? "Unknown fund"}
                    {noMix && (
                      <button
                        type="button"
                        className={`ml-2 underline ${STATUS_COLORS.amber.text}`}
                        onClick={() => setFactsFor(Number(id))}
                      >
                        mix unknown — enter it
                      </button>
                    )}
                  </span>
                  <span>
                    {formatNumber(w * 100, 1)}%
                    {p.basis === "observed" && " at start"}
                  </span>
                </div>
                {factsFor === Number(id) && f?.facts && (
                  <FactsForm
                    holding={{ securityId: f.id, facts: f.facts }}
                    onDone={() => setFactsFor(null)}
                  />
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function PeriodForm({
  accountId,
  draft,
  setDraft,
  funds,
}: {
  accountId: number;
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  funds: Data["funds"];
}) {
  const utils = trpc.useUtils();
  const [ticker, setTicker] = useState("");
  const [fundName, setFundName] = useState("");
  const refresh = () => utils.investments.invalidate();
  const save = trpc.investments.saveHoldingPeriod.useMutation({
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
  });
  const addRow = (securityId: number) =>
    setDraft({
      ...draft,
      rows: [
        ...draft.rows.filter((r) => r.securityId !== null),
        row(securityId),
      ],
    });
  const byTicker = trpc.investments.addFundByTicker.useMutation({
    onSuccess: ({ id }) => {
      refresh();
      addRow(id);
      setTicker("");
    },
  });
  const byName = trpc.investments.addFundByName.useMutation({
    onSuccess: ({ id }) => {
      refresh();
      addRow(id);
      setFundName("");
    },
  });
  const total = sumBy(draft.rows, (r) => Number(r.pct) || 0);
  const input = "border-strong bg-surface-primary rounded border px-1.5 py-0.5";
  return (
    <div className="bg-surface-elevated mt-3 space-y-2 rounded p-3 text-xs">
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1">
          From
          <input
            type="date"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            className={input}
          />
        </label>
        <label className="flex items-center gap-1">
          To
          <input
            type="date"
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            className={input}
          />
          <span className="text-faint">(blank = still held)</span>
        </label>
      </div>
      {draft.rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2">
          <select
            value={r.securityId ?? ""}
            onChange={(e) => {
              const rows = [...draft.rows];
              rows[i] = { ...r, securityId: Number(e.target.value) || null };
              setDraft({ ...draft, rows });
            }}
            className={`${input} min-w-0 flex-1`}
          >
            <option value="">Pick a fund…</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            value={r.pct}
            onChange={(e) => {
              const rows = [...draft.rows];
              rows[i] = { ...r, pct: e.target.value };
              setDraft({ ...draft, rows });
            }}
            inputMode="decimal"
            className={`${input} w-16`}
            aria-label="Share of the account"
          />
          %
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              setDraft({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            setDraft({
              ...draft,
              rows: [...draft.rows, row(null)],
            })
          }
        >
          Another fund
        </Button>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker"
          className={`${input} w-20`}
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={!ticker.trim() || byTicker.isPending}
          onClick={() => byTicker.mutate({ ticker })}
        >
          Add by ticker
        </Button>
        <input
          value={fundName}
          onChange={(e) => setFundName(e.target.value)}
          placeholder="Plan fund name (no ticker)"
          className={`${input} w-48`}
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={fundName.trim().length < 2 || byName.isPending}
          onClick={() => byName.mutate({ name: fundName })}
        >
          Add by name
        </Button>
      </div>
      {(byTicker.error || byName.error) && (
        <p className={STATUS_COLORS.red.text}>
          {(byTicker.error ?? byName.error)!.message}
        </p>
      )}
      {Math.abs(total - 100) > 0.5 && draft.rows.some((r) => r.pct) && (
        <p className={STATUS_COLORS.amber.text}>
          Adds up to {formatNumber(total, 1)}%, not 100%.
        </p>
      )}
      {save.isError && (
        <p className={STATUS_COLORS.red.text}>{save.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="primary"
          disabled={save.isPending || !draft.start}
          onClick={() =>
            save.mutate({
              id: draft.id,
              performanceAccountId: accountId,
              start: draft.start,
              end: draft.end || null,
              notes: draft.notes.trim() || null,
              weights: draft.rows
                .filter((r) => r.securityId !== null)
                .map((r) => ({
                  securityId: r.securityId!,
                  weight: (Number(r.pct) || 0) / 100,
                })),
            })
          }
        >
          Save period
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
