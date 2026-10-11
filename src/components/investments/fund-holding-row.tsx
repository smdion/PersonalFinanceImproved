"use client";

/**
 * One fund in an account: ticker, asset mix, yearly fee and value, where
 * each fact came from, and — when `editable` — the household's controls
 * for it: use or reject a suggested stand-in ("twin") fund, look for one
 * again, or enter the fund's own fee and mix. Editing lives on the
 * Portfolio page's account settings; Benchmarks shows it read-only.
 */
import { TickerLink } from "./ticker-link";
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
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

export type Overview = RouterOutputs["investments"]["getHoldingsOverview"];
export type Holding = Overview["accounts"][number]["holdings"][number];

export const BUCKET_COLORS: Record<CompositionBucket, string> = {
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

export function MixBar({ facts }: { facts: Holding["facts"] }) {
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
  const clear = trpc.investments.clearUserFacts.useMutation({
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
        From your plan&apos;s fee disclosure or the fund&apos;s fact sheet. Fill
        in either or both — what you enter is used instead of SEC&apos;s or a
        stand-in&apos;s; the other stays as it is.
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
              expenseRatio: er === "" ? undefined : Number(er) / 100,
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
        {holding.facts.expenseRatio?.fromUser && (
          <Button
            size="xs"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() =>
              clear.mutate({
                securityId: holding.securityId,
                part: "expenseRatio",
              })
            }
          >
            Clear my fee
          </Button>
        )}
        {holding.facts.composition?.fromUser && (
          <Button
            size="xs"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() =>
              clear.mutate({
                securityId: holding.securityId,
                part: "composition",
              })
            }
          >
            Clear my mix
          </Button>
        )}
      </div>
    </div>
  );
}

/** Where one fact came from, in words. */
function sourceLabel(
  h: Holding,
  fact: { fromUser: boolean; asOf: string } | null,
  kind: "fee" | "mix",
): string | null {
  if (!fact) return null;
  if (fact.fromUser) return "your entry";
  if (h.factsBasis === "standin")
    return `Estimated — stand-in ${h.factsSeriesName}${kind === "fee" ? ", cheapest share class" : ""}`;
  return `SEC, ${shortDay(fact.asOf)}`;
}

export function HoldingRow({
  h,
  editable,
}: {
  h: Holding;
  /** Show the household's controls (Portfolio); read-only elsewhere. */
  editable: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const refresh = () => utils.investments.invalidate();
  const confirm = trpc.investments.confirmStandIn.useMutation({
    onSuccess: refresh,
  });
  const reject = trpc.investments.rejectStandIn.useMutation({
    onSuccess: refresh,
  });
  const find = trpc.investments.findStandIn.useMutation({ onSuccess: refresh });
  const privacy = isPrivacyMode();
  const er = h.facts.expenseRatio;
  const mixSource = sourceLabel(h, h.facts.composition, "mix");
  const feeSource = sourceLabel(h, er, "fee");
  return (
    <div className="border-subtle border-b py-1.5 text-xs last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          {h.symbol && <TickerLink symbol={h.symbol} />}
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
        {mixSource && <span>· Mix: {mixSource}</span>}
        {feeSource && <span>· Fee: {feeSource}</span>}
        {h.facts.stale && (
          <span className="text-amber-600">· facts over 15 months old</span>
        )}
        {editable && (
          <button
            className="hover:text-primary underline"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "close" : "edit facts"}
          </button>
        )}
        {editable && h.factsBasis === "standin" && !h.standInPending && (
          <button
            className="hover:text-primary underline"
            disabled={reject.isPending}
            onClick={() => reject.mutate({ securityId: h.securityId })}
          >
            stop using stand-in
          </button>
        )}
        {editable && h.factsBasis === "none" && (
          <button
            className="hover:text-primary underline"
            disabled={find.isPending}
            onClick={() => find.mutate({ securityId: h.securityId })}
          >
            {find.isPending ? "looking…" : "look for a stand-in again"}
          </button>
        )}
      </div>
      {find.isSuccess && !find.data.suggestion && (
        <p className="text-caption text-faint mt-0.5">
          No registered fund with a matching name — enter this fund&apos;s facts
          instead.
        </p>
      )}
      {!editable && h.standInPending && (
        <p className="text-caption mt-0.5 text-amber-700 dark:text-amber-400">
          A possible stand-in fund needs your OK — Portfolio → Account &amp;
          Contribution Settings → this account.
        </p>
      )}
      {editable && h.standInPending && (
        <div className="mt-1 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          SEC has no filings for this fund (plan-only funds don&apos;t file with
          SEC). By name, it looks like{" "}
          <span className="font-medium">{h.factsSeriesName}</span> — a
          different, registered fund that likely follows the same strategy or
          index. Check your plan&apos;s fact sheet; if the mix matches, Ledgr
          can use it as a stand-in. Values will be marked Estimated, and its fee
          is a retail fund&apos;s — enter your plan&apos;s real fee with
          &ldquo;edit facts&rdquo;.
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
      {editable && editing && (
        <FactsForm holding={h} onDone={() => setEditing(false)} />
      )}
    </div>
  );
}
