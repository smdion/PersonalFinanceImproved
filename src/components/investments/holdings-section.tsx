"use client";

/**
 * Benchmarks → what you hold now, how it's split, how that compares with
 * your target, and what it costs. Holdings from SimpleFIN, priced at
 * today's close (Tiingo); fund facts from SEC filings or your own entries.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  isPrivacyMode,
} from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
} from "@/lib/config/enum-values";

type Overview = RouterOutputs["investments"]["getHoldingsOverview"];
type Holding = Overview["accounts"][number]["holdings"][number];

const BUCKET_COLORS: Record<CompositionBucket, string> = {
  us_equity: CHART_COLORS.mixUsEquity,
  intl_equity: CHART_COLORS.mixIntlEquity,
  us_bond: CHART_COLORS.mixUsBond,
  intl_bond: CHART_COLORS.mixIntlBond,
  tips: CHART_COLORS.mixTips,
  cash: CHART_COLORS.mixCash,
  other: CHART_COLORS.mixOther,
};

const shortDay = (day: string) =>
  formatDate(day, "medium").replace(`, ${new Date().getFullYear()}`, "");

function MixBar({ facts }: { facts: Holding["facts"] }) {
  const c = facts.composition;
  if (!c) return <span className="text-faint text-caption">Mix unknown</span>;
  const parts = COMPOSITION_BUCKET_VALUES.filter((b) => c.buckets[b] > 0.005);
  return (
    <Tooltip
      lines={[
        ...parts.map(
          (b) =>
            `${COMPOSITION_BUCKET_LABELS[b]} ${formatPercent(c.buckets[b], 1)}`,
        ),
        ...(c.coverage < 0.995
          ? [`Covers ${formatPercent(c.coverage, 0)} of the fund's holdings`]
          : []),
        c.fromUser ? "Entered by you" : `SEC filing, ${shortDay(c.asOf)}`,
      ]}
    >
      <div className="bg-surface-strong flex h-2 w-24 overflow-hidden rounded">
        {parts.map((b) => (
          <div
            key={b}
            style={{
              width: `${c.buckets[b] * 100}%`,
              backgroundColor: BUCKET_COLORS[b],
            }}
          />
        ))}
      </div>
    </Tooltip>
  );
}

function FactsForm({
  holding,
  onDone,
}: {
  holding: Holding;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [er, setEr] = useState(
    holding.facts.expenseRatio
      ? String(+(holding.facts.expenseRatio.value * 100).toFixed(4))
      : "",
  );
  const [mix, setMix] = useState<Record<CompositionBucket, string>>(
    Object.fromEntries(
      COMPOSITION_BUCKET_VALUES.map((b) => [
        b,
        holding.facts.composition
          ? String(+(holding.facts.composition.buckets[b] * 100).toFixed(1))
          : "",
      ]),
    ) as Record<CompositionBucket, string>,
  );
  const save = trpc.investments.setUserFacts.useMutation({
    onSuccess: () => {
      utils.investments.invalidate();
      onDone();
    },
  });
  const mixTotal = COMPOSITION_BUCKET_VALUES.reduce(
    (s, b) => s + (Number(mix[b]) || 0),
    0,
  );
  const hasMix = COMPOSITION_BUCKET_VALUES.some((b) => mix[b] !== "");
  return (
    <div className="bg-surface-elevated mt-1 space-y-2 rounded p-3 text-xs">
      <p className="text-faint">
        From your plan&apos;s fee disclosure or the fund&apos;s fact sheet. Your
        entries are used instead of SEC&apos;s.
      </p>
      <label className="flex items-center gap-2">
        <span className="text-muted w-28">Expense ratio</span>
        <input
          value={er}
          onChange={(e) => setEr(e.target.value)}
          className="border-strong bg-surface-primary w-20 rounded border px-1.5 py-0.5"
          inputMode="decimal"
        />
        %
      </label>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {COMPOSITION_BUCKET_VALUES.map((b) => (
          <label key={b} className="flex items-center gap-1">
            <span className="text-muted flex-1">
              {COMPOSITION_BUCKET_LABELS[b]}
            </span>
            <input
              value={mix[b]}
              onChange={(e) => setMix({ ...mix, [b]: e.target.value })}
              className="border-strong bg-surface-primary w-14 rounded border px-1 py-0.5"
              inputMode="decimal"
            />
            %
          </label>
        ))}
      </div>
      {hasMix && Math.abs(mixTotal - 100) > 0.5 && (
        <p className="text-amber-600">
          Mix adds up to {formatNumber(mixTotal, 1)}%, not 100%.
        </p>
      )}
      {save.isError && <p className="text-red-600">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button
          size="xs"
          variant="primary"
          disabled={
            save.isPending || (hasMix && Math.abs(mixTotal - 100) > 0.5)
          }
          onClick={() =>
            save.mutate({
              securityId: holding.securityId,
              expenseRatio: er === "" ? null : Number(er) / 100,
              composition: hasMix
                ? (Object.fromEntries(
                    COMPOSITION_BUCKET_VALUES.map((b) => [
                      b,
                      (Number(mix[b]) || 0) / 100,
                    ]),
                  ) as Record<CompositionBucket, number>)
                : undefined,
            })
          }
        >
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function HoldingRow({ h }: { h: Holding }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const confirm = trpc.investments.confirmStandIn.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const reject = trpc.investments.rejectStandIn.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const privacy = isPrivacyMode();
  const er = h.facts.expenseRatio;
  const factsLabel =
    h.factsBasis === "standin" && !h.standInPending
      ? `Estimated — stand-in ${h.factsSeriesName}`
      : h.facts.composition?.fromUser || er?.fromUser
        ? "Your entry"
        : h.facts.composition || er
          ? "SEC"
          : null;
  return (
    <div className="border-subtle border-b py-1.5 text-xs last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          {h.symbol && (
            <span className="text-primary mr-1 font-mono">{h.symbol}</span>
          )}
          <span className="text-muted">{h.name}</span>
        </div>
        <MixBar facts={h.facts} />
        <span className="text-muted w-16 text-right">
          {er ? formatPercent(er.value, er.value < 0.001 ? 3 : 2) : "—"}
        </span>
        <span className="text-primary w-24 text-right">
          {formatCurrency(h.value)}
        </span>
      </div>
      <div className="text-caption text-faint mt-0.5 flex flex-wrap gap-x-2">
        <span>
          {privacy ? "•••• sh" : `${formatNumber(h.shares, 3)} sh`} ·{" "}
          {h.valueBasis === "priced"
            ? `${shortDay(h.valuedOn)} close`
            : `As reported ${shortDay(h.valuedOn)}`}
        </span>
        {factsLabel && <span>· {factsLabel}</span>}
        {h.facts.stale && (
          <span className="text-amber-600">· facts over 15 months old</span>
        )}
        <button
          className="hover:text-primary underline"
          onClick={() => setEditing(!editing)}
        >
          {editing ? "close" : "edit facts"}
        </button>
      </div>
      {h.standInPending && (
        <div className="mt-1 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          SEC has no filings for this fund. Use{" "}
          <span className="font-medium">{h.factsSeriesName}</span> as a stand-in
          for its expense ratio and mix? Values will be marked Estimated.
          <div className="mt-1 flex gap-2">
            <Button
              size="xs"
              variant="primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate({ securityId: h.securityId })}
            >
              {confirm.isPending ? "Fetching…" : "Use it"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => reject.mutate({ securityId: h.securityId })}
            >
              Not a match
            </Button>
          </div>
        </div>
      )}
      {editing && <FactsForm holding={h} onDone={() => setEditing(false)} />}
    </div>
  );
}

function AllocationCard({ data }: { data: Overview }) {
  const utils = trpc.useUtils();
  const link = trpc.investments.setCompositionBucket.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const { total, unknown, rows, unmapped } = data.allocation;
  const known = total - unknown;
  const hasTarget = rows.some((r) => r.targetPct !== null);
  return (
    <Card title="Your mix vs your target">
      <p className="text-caption text-faint mb-3">
        What your funds hold, added up across accounts
        {hasTarget && data.age !== null
          ? `, next to your glide-path target for age ${data.age}`
          : ""}
        . Percentages are of the{" "}
        {formatPercent(total > 0 ? known / total : 0, 0)} of your money whose
        mix is known.
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const pct = known > 0 ? r.value / known : 0;
          const drift = r.targetPct !== null ? pct - r.targetPct : null;
          return (
            <div key={r.assetClassId} className="text-xs">
              <div className="flex justify-between">
                <span className="text-primary">{r.name}</span>
                <span className="text-muted">
                  {formatPercent(pct, 1)}
                  {r.targetPct !== null && (
                    <>
                      {" "}
                      vs {formatPercent(r.targetPct, 0)} target{" "}
                      {drift !== null && Math.abs(drift) >= 0.005 && (
                        <span
                          className={
                            Math.abs(drift) > 0.05
                              ? "text-amber-600"
                              : "text-faint"
                          }
                        >
                          ({drift > 0 ? "+" : ""}
                          {formatPercent(drift, 1)})
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
              <div className="bg-surface-strong relative mt-0.5 h-2 rounded">
                <div
                  className="h-2 rounded"
                  style={{
                    width: `${Math.min(100, pct * 100)}%`,
                    backgroundColor: r.bucket
                      ? BUCKET_COLORS[r.bucket]
                      : CHART_COLORS.mixOther,
                  }}
                />
                {r.targetPct !== null && (
                  <div
                    className="bg-primary absolute -top-0.5 h-3 w-0.5"
                    style={{ left: `${Math.min(100, r.targetPct * 100)}%` }}
                    title="Target"
                  />
                )}
              </div>
              {!r.bucket && (
                <p className="text-caption text-faint">
                  Not linked to a fund category.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {unmapped.length > 0 && (
        <div className="mt-3 space-y-1 text-xs">
          {unmapped.map((u) => {
            const free = rows.filter((r) => !r.bucket);
            return (
              <div key={u.bucket} className="flex flex-wrap items-center gap-2">
                <span className="text-muted">
                  {COMPOSITION_BUCKET_LABELS[u.bucket]} (
                  {formatCurrency(u.value)})
                  {free.length > 0
                    ? " isn't linked to one of your asset classes:"
                    : " isn't one of your asset classes, so it's left out of the comparison."}
                </span>
                {free.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) =>
                      e.target.value &&
                      link.mutate({
                        assetClassId: Number(e.target.value),
                        bucket: u.bucket,
                      })
                    }
                    className="border-strong bg-surface-primary rounded border px-1.5 py-0.5"
                  >
                    <option value="">Link to…</option>
                    {free.map((r) => (
                      <option key={r.assetClassId} value={r.assetClassId}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
      {unknown > 0.5 && (
        <p className="text-caption text-faint mt-3">
          {formatCurrency(unknown)} isn&apos;t included yet — funds without a
          known mix. Confirm a stand-in or enter their facts above.
        </p>
      )}
    </Card>
  );
}

export function HoldingsSection() {
  const { data } = trpc.investments.getHoldingsOverview.useQuery();
  if (!data) return null;
  if (data.accounts.length === 0)
    return (
      <Card title="What you hold now">
        <p className="text-faint text-sm">
          No holdings reported yet. Connect SimpleFIN in Settings →
          Integrations; institutions that report holdings appear here after the
          next sync.
        </p>
      </Card>
    );
  const cost = data.cost;
  return (
    <div className="space-y-4">
      <Card title="What you hold now">
        {!data.secConnected && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
            Set up SEC fund facts in Settings → Integrations to see each
            fund&apos;s mix and expense ratio.
          </p>
        )}
        <div className="space-y-4">
          {data.accounts.map((a) => (
            <div key={a.simplefinAccountId}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-secondary font-medium">{a.label}</span>
                <span className="text-muted">{formatCurrency(a.total)}</span>
              </div>
              {a.holdings.map((h) => (
                <HoldingRow key={h.securityId} h={h} />
              ))}
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationCard data={data} />
        <Card title="What it costs">
          {cost.expenseRatio === null ? (
            <p className="text-faint text-sm">
              No expense ratios yet — they come from SEC filings or your own
              entries.
            </p>
          ) : (
            <>
              <p className="text-primary text-2xl font-semibold">
                {formatPercent(cost.expenseRatio, 2)}
                <span className="text-muted ml-2 text-sm font-normal">
                  a year
                </span>
              </p>
              <p className="text-muted mt-1 text-sm">
                About {formatCurrency(cost.yearlyCost)} a year in fund fees.
              </p>
              {cost.coveredShare < 0.995 && (
                <p className="text-caption text-faint mt-1">
                  Covers {formatPercent(cost.coveredShare, 0)} of your money —
                  funds without a known expense ratio aren&apos;t included.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
