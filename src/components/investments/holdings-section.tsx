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
