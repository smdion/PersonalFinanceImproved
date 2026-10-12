"use client";

/**
 * Benchmarks → what you hold now, how it's split, how that compares with
 * your target, and what it costs. Holdings from SimpleFIN, priced at
 * today's close (Tiingo); fund facts from SEC filings or your own entries.
 */
import { BUCKET_COLORS, HoldingRow, type Overview } from "./fund-holding-row";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import { COMPOSITION_BUCKET_VALUES } from "@/lib/config/enum-values";

type OverviewAccount = Overview["accounts"][number];

/**
 * The account's name and total; for an account holding several funds, also
 * their combined mix and blended fee, in the same columns as the fund rows.
 */
function AccountHeader({ a }: { a: OverviewAccount }) {
  const r = a.rollup;
  const er = r?.cost.expenseRatio ?? null;
  const parts = r?.mix
    ? COMPOSITION_BUCKET_VALUES.filter((b) => r.mix![b] >= 0.005)
    : [];
  return (
    <div className="mb-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-secondary min-w-0 flex-1 font-medium">
          {a.label}
        </span>
        {r && (
          <>
            {r.mix ? (
              <div className="bg-surface-strong flex h-2 w-24 overflow-hidden rounded">
                {parts.map((b) => (
                  <div
                    key={b}
                    style={{
                      width: `${r.mix![b] * 100}%`,
                      backgroundColor: BUCKET_COLORS[b],
                    }}
                  />
                ))}
              </div>
            ) : (
              <span className="text-faint text-caption">Mix unknown</span>
            )}
            <span className="text-muted w-16 text-right">
              {er !== null ? formatPercent(er, er < 0.001 ? 3 : 2) : "—"}
            </span>
          </>
        )}
        <span className="text-secondary w-24 text-right font-medium">
          {formatCurrency(a.total)}
        </span>
      </div>
      {r?.mix && (
        <p className="text-caption text-faint mt-0.5">
          All funds:{" "}
          {parts
            .map(
              (b) =>
                `${COMPOSITION_BUCKET_LABELS[b]} ${formatPercent(r.mix![b], 0)}`,
            )
            .join(" · ")}
          {r.coverage < 0.995 &&
            ` (mix known for ${formatPercent(r.coverage, 0)})`}
          {er !== null &&
            ` · about ${formatCurrency(r.cost.yearlyCost)} a year in fees`}
        </p>
      )}
    </div>
  );
}

/** "+1.2%" in amber when it's more than 5 points off, faint otherwise. */
function Drift({ pct, target }: { pct: number; target: number }) {
  const drift = pct - target;
  if (Math.abs(drift) < 0.005) return null;
  return (
    <span className={Math.abs(drift) > 0.05 ? "text-amber-600" : "text-faint"}>
      {" "}
      ({drift > 0 ? "+" : ""}
      {formatPercent(drift, 1)})
    </span>
  );
}

function MixBarRow({
  label,
  pct,
  target,
  color,
  note,
  children,
}: {
  label: string;
  pct: number;
  target: number | null;
  color: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-2">
        <span className="text-primary">{label}</span>
        <span className="text-muted">
          {formatPercent(pct, 1)}
          {target !== null ? (
            <>
              {" "}
              vs {formatPercent(target, 0)} target
              <Drift pct={pct} target={target} />
            </>
          ) : (
            note && <span className="text-faint"> · {note}</span>
          )}
        </span>
      </div>
      <div className="bg-surface-strong relative mt-0.5 h-2 rounded">
        <div
          className="h-2 rounded"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            backgroundColor: color,
          }}
        />
        {target !== null && (
          <div
            className="bg-primary absolute -top-0.5 h-3 w-0.5"
            style={{ left: `${Math.min(100, target * 100)}%` }}
            title="Target"
          />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Every major fund category as its own row, next to the glide-path target
 * of the asset class it counts toward. A class that takes several
 * categories shows its target once, on a combined line after them.
 */
function AllocationCard({ data }: { data: Overview }) {
  const utils = trpc.useUtils();
  const link = trpc.investments.linkCompositionBucket.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  const { total, unknown, rows, unmapped, categories } = data.allocation;
  const known = total - unknown;
  const share = (v: number) => (known > 0 ? v / known : 0);
  const hasTarget = rows.some((r) => r.targetPct !== null);
  const classOf = new Map(rows.map((r) => [r.assetClassId, r]));
  const minor = unmapped.filter(
    (u) => !categories.some((c) => c.bucket === u.bucket),
  );
  const noCategory = rows.filter((r) => r.buckets.length === 0);
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
        {categories.map((c) => {
          const cls =
            c.assetClassId !== null ? classOf.get(c.assetClassId) : undefined;
          const shared = cls !== undefined && cls.buckets.length > 1;
          const lastOfClass = shared && cls.buckets.at(-1) === c.bucket;
          return (
            <div key={c.bucket} className="space-y-2">
              <MixBarRow
                label={COMPOSITION_BUCKET_LABELS[c.bucket]}
                pct={share(c.value)}
                target={cls && !shared ? cls.targetPct : null}
                color={BUCKET_COLORS[c.bucket]}
                note={
                  cls
                    ? shared
                      ? `target shared — see ${cls.name}`
                      : undefined
                    : "no target in your plan"
                }
              >
                {!cls && rows.length > 0 && (
                  <div className="text-caption text-faint mt-0.5 flex flex-wrap items-center gap-1">
                    Give it a target by counting it in one of your asset
                    classes:
                    <select
                      value=""
                      disabled={link.isPending}
                      onChange={(e) =>
                        e.target.value &&
                        link.mutate({
                          bucket: c.bucket,
                          assetClassId: Number(e.target.value),
                        })
                      }
                      className="border-strong bg-surface-primary rounded border px-1 py-0"
                    >
                      <option value="">Count it in…</option>
                      {rows.map((r) => (
                        <option key={r.assetClassId} value={r.assetClassId}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </MixBarRow>
              {lastOfClass && (
                <MixBarRow
                  label={`${cls.name} (${cls.buckets
                    .map((b) => COMPOSITION_BUCKET_LABELS[b])
                    .join(" + ")})`}
                  pct={share(cls.value)}
                  target={cls.targetPct}
                  color={CHART_COLORS.mixOther}
                >
                  <p className="text-caption text-faint mt-0.5">
                    {cls.buckets.slice(1).map((b) => (
                      <button
                        key={b}
                        className="hover:text-primary mr-2 underline"
                        disabled={link.isPending}
                        title={`Projections use ${cls.name}'s return and risk for everything counted in it.`}
                        onClick={() =>
                          link.mutate({ bucket: b, assetClassId: null })
                        }
                      >
                        Stop counting {COMPOSITION_BUCKET_LABELS[b]} in{" "}
                        {cls.name}
                      </button>
                    ))}
                  </p>
                </MixBarRow>
              )}
            </div>
          );
        })}
      </div>
      {(minor.length > 0 || noCategory.length > 0) && (
        <div className="text-caption text-faint mt-3 space-y-0.5">
          {minor.map((u) => (
            <p key={u.bucket}>
              {COMPOSITION_BUCKET_LABELS[u.bucket]} ({formatCurrency(u.value)})
              — holdings that aren&apos;t stocks, bonds or cash — is left out of
              the comparison.
            </p>
          ))}
          {noCategory.map((r) => (
            <p key={r.assetClassId}>
              {r.name}
              {r.targetPct !== null
                ? ` (${formatPercent(r.targetPct, 0)} target)`
                : ""}{" "}
              isn&apos;t linked to a fund category, so nothing counts toward it.
            </p>
          ))}
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
        <p className="text-caption text-faint mb-2">
          To confirm a stand-in fund or enter a fund&apos;s own fee and mix,
          open the account in Portfolio → Account &amp; Contribution Settings.
        </p>
        {!data.secConnected && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
            Set up SEC fund facts in Settings → Integrations to see each
            fund&apos;s mix and expense ratio.
          </p>
        )}
        <div className="space-y-4">
          {data.accounts.map((a) => (
            <div key={a.simplefinAccountId}>
              <AccountHeader a={a} />
              {a.holdings.map((h) => (
                <HoldingRow key={h.securityId} h={h} editable={false} />
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
