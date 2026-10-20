"use client";

/**
 * Benchmarks → what you hold now, how it's split, how that compares with
 * your target, and what it costs. Holdings from SimpleFIN, priced at
 * today's close (Tiingo); fund facts from SEC filings or your own entries.
 */
import { FULL_SHARE, NEGLIGIBLE_SHARE } from "@/lib/constants";
import { useState } from "react";
import {
  BUCKET_COLORS,
  HoldingRow,
  MixBar,
  type Holding,
  type Overview,
} from "./fund-holding-row";
import { TickerLink } from "./ticker-link";
import { CurrentGlidePathEditor } from "./current-glide-path-editor";
import { GlidePathChart, type GlidePathClass } from "./glide-path-chart";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { isHsaCategory } from "@/lib/config/account-types";
import { HsaCashBuffer } from "./hsa-cash-buffer";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  isPrivacyMode,
} from "@/lib/utils/format";
import { combineHoldings, fundsInBucket } from "@/lib/pure/fund-facts";
import { CHART_COLORS } from "@/lib/utils/colors";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import {
  COMPOSITION_BUCKET_VALUES,
  isStockBucket,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import { SettingsLink } from "@/components/ui/settings-link";
import { PortfolioAccountsLink } from "@/components/portfolio/portfolio-accounts-link";

type OverviewAccount = Overview["accounts"][number];

/** How "What you hold now" lists holdings; remembered per browser. */
type HoldingsView = "account" | "fund";
const VIEW_KEY = "ledgr:benchmarks-holdings-view";

function savedView(): HoldingsView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "fund"
      ? "fund"
      : "account";
  } catch {
    return "account";
  }
}

/** One fund across every account that holds it. */
function FundRow({
  f,
}: {
  f: ReturnType<typeof combineHoldings<Holding>>[number];
}) {
  const h = f.holding;
  const er = h.facts.expenseRatio;
  return (
    <div className="border-subtle border-b py-1.5 text-xs last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          {h.symbol &&
            (h.symbolConfirmed ? (
              <TickerLink symbol={h.symbol} />
            ) : (
              <span className="text-muted mr-1.5 font-mono">{h.symbol}</span>
            ))}
          <span className="text-muted">{h.name}</span>
        </div>
        <MixBar facts={h.facts} />
        <span className="text-muted w-16 text-right">
          {er ? formatPercent(er.value, er.value < 0.001 ? 3 : 2) : "—"}
        </span>
        <span className="text-muted w-14 text-right">
          {formatPercent(f.share, 1)}
        </span>
        <span className="text-primary w-24 text-right">
          {formatCurrency(f.value)}
        </span>
      </div>
      <p className="text-caption text-faint mt-0.5">
        {isPrivacyMode() ? "•••• sh" : `${formatNumber(f.shares, 3)} sh`} ·{" "}
        {f.accounts
          .map((a) =>
            f.accounts.length > 1
              ? `${a.label} ${formatCurrency(a.value)}`
              : a.label,
          )
          .join(" · ")}
      </p>
    </div>
  );
}

/**
 * The account's name and total; for an account holding several funds, also
 * their combined mix and blended fee, in the same columns as the fund rows.
 */
function AccountHeader({ a }: { a: OverviewAccount }) {
  const r = a.rollup;
  const er = r?.cost.expenseRatio ?? null;
  const parts = r?.mix
    ? COMPOSITION_BUCKET_VALUES.filter((b) => r.mix![b] >= NEGLIGIBLE_SHARE)
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
          {r.coverage < FULL_SHARE &&
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
  if (Math.abs(drift) < NEGLIGIBLE_SHARE) return null;
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
  expanded,
  onToggle,
  children,
}: {
  label: string;
  pct: number;
  target: number | null;
  color: string;
  note?: string;
  /** Set (with onToggle) when the row can list what makes it up. */
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-2">
        {onToggle ? (
          <button
            className="text-primary hover:underline"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? "▾" : "▸"} {label}
          </button>
        ) : (
          <span className="text-primary">{label}</span>
        )}
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
  const [open, setOpen] = useState<CompositionBucket | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const canEditPath = isAdmin(useUser());
  const funds = combineHoldings(data.accounts);
  return (
    <Card title="Your mix vs your target">
      <p className="text-caption text-faint mb-3">
        What your funds hold, added up across accounts
        {hasTarget && data.age !== null
          ? `, next to ${data.targetSource === "current" ? "your current glide path" : "the retirement simulation's glide path"} for age ${data.age}`
          : ""}
        .
        {data.currentGlidePathStale && (
          <>
            {" "}
            <span className="text-amber-600">
              Your current glide path uses an asset class that no longer exists,
              so the retirement glide path is used until you edit it.
            </span>
          </>
        )}{" "}
        Percentages are of the {formatPercent(total > 0 ? known / total : 0, 0)}{" "}
        of your money whose mix is known.{" "}
        {canEditPath && !editingPath && (
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => setEditingPath(true)}
          >
            {data.targetSource === "current"
              ? "Edit your current glide path"
              : "Set a current glide path"}
          </button>
        )}
      </p>
      {editingPath && (
        <CurrentGlidePathEditor
          classes={rows.map((r) => ({
            assetClassId: r.assetClassId,
            name: r.name,
          }))}
          currentGlidePath={data.currentGlidePath}
          age={data.age}
          todaysTarget={Object.fromEntries(
            rows.map((r) => [r.assetClassId, r.targetPct]),
          )}
          onClose={() => setEditingPath(false)}
        />
      )}
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
                expanded={open === c.bucket}
                onToggle={
                  c.value > 0
                    ? () => setOpen(open === c.bucket ? null : c.bucket)
                    : undefined
                }
              >
                {open === c.bucket && (
                  <ul className="text-caption mt-1 mb-1 space-y-0.5 pl-3">
                    {fundsInBucket(funds, c.bucket).map((f) => (
                      <li
                        key={f.holding.securityId}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-muted truncate">
                          {f.holding.symbol ? `${f.holding.symbol} · ` : ""}
                          {f.holding.name}
                        </span>
                        <span className="text-faint whitespace-nowrap">
                          {formatCurrency(f.value)} ·{" "}
                          {formatPercent(f.share, 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
      {data.unlinkedAccounts.length > 0 && (
        <details className="text-caption text-faint mt-1">
          <summary className="cursor-pointer">
            Not counted: {data.unlinkedAccounts.length} SimpleFIN account
            {data.unlinkedAccounts.length === 1 ? "" : "s"} (
            {formatCurrency(
              data.unlinkedAccounts.reduce((s, a) => s + a.total, 0),
            )}
            ) not linked to any of your Ledgr accounts
          </summary>
          <p className="mt-1">
            Only accounts linked to a Ledgr account count, so the same money is
            never counted twice — an unlinked feed is usually a duplicate or an
            old connection to an account that&apos;s already linked. If one is
            real money Ledgr doesn&apos;t track yet, link it in{" "}
            <SettingsLink tab="integrations" section="simplefin" />.
          </p>
          <ul className="mt-1 list-inside list-disc">
            {data.unlinkedAccounts.map((a) => (
              <li key={a.simplefinAccountId}>
                {a.label} ({formatCurrency(a.total)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Asset classes in stacking order (stocks at the bottom), each colored
 *  like its first fund category on the mix card. */
function glidePathClasses(data: Overview): GlidePathClass[] {
  // Config order (stocks first, so they stack at the bottom).
  const rank = (b: CompositionBucket | undefined) =>
    b === undefined
      ? COMPOSITION_BUCKET_VALUES.length
      : COMPOSITION_BUCKET_VALUES.indexOf(b);
  return [...data.allocation.rows]
    .filter((r) =>
      data.glidePath.some((p) => (p.allocations[r.assetClassId] ?? 0) > 0),
    )
    .sort((a, b) => rank(a.buckets[0]) - rank(b.buckets[0]))
    .map((r) => ({
      assetClassId: r.assetClassId,
      name: r.name,
      color: r.buckets[0] ? BUCKET_COLORS[r.buckets[0]] : CHART_COLORS.mixOther,
      isStock: r.buckets.some(isStockBucket),
    }));
}

function GlidePathCard({ data }: { data: Overview }) {
  const projection = useDashboardProjection();
  const retirementAge =
    projection.data && "settings" in projection.data && projection.data.settings
      ? Number(projection.data.settings.retirementAge) || null
      : null;
  if (data.glidePath.length === 0) return null;
  return (
    <Card
      title={
        data.targetSource === "current"
          ? "Your current glide path"
          : "Your glide path (from the retirement plan)"
      }
    >
      <p className="text-caption text-faint mb-2">
        The target mix by age that your mix is compared with. Your stocks are
        the bottom two bands — compare the top of them (where the blues meet the
        green) with the dashed line: Vanguard&apos;s target-date stock share,
        shifted to your retirement age. Above the line, you hold more stock than
        Vanguard would; below it, less.
      </p>
      <GlidePathChart
        path={data.glidePath}
        classes={glidePathClasses(data)}
        age={data.age}
        retirementAge={retirementAge}
      />
    </Card>
  );
}

export function HoldingsSection() {
  const { data } = trpc.investments.getHoldingsOverview.useQuery();
  // Holdings load on the client, so nothing renders before this is read.
  const [view, setView] = useState<HoldingsView>(savedView);
  const chooseView = (v: HoldingsView) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage unavailable (private window): the choice lasts this visit.
    }
  };
  if (!data) return null;
  if (data.accounts.length === 0)
    return (
      <Card title="What you hold now">
        <p className="text-faint text-sm">
          No holdings reported yet. Connect SimpleFIN in{" "}
          <SettingsLink tab="integrations" section="simplefin" />; institutions
          that report holdings appear here after the next sync.
        </p>
      </Card>
    );
  const cost = data.cost;
  return (
    <div className="space-y-4">
      <Card
        title="What you hold now"
        headerRight={
          <div className="flex rounded border text-xs" role="group">
            {(["account", "fund"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={`px-2 py-0.5 ${view === v ? "bg-surface-strong text-primary" : "text-muted"}`}
                onClick={() => chooseView(v)}
              >
                {v === "account" ? "By account" : "By fund"}
              </button>
            ))}
          </div>
        }
      >
        <p className="text-caption text-faint mb-2">
          To confirm a stand-in fund or enter a fund&apos;s own fee and mix,
          open the account in <PortfolioAccountsLink />.
        </p>
        {!data.secConnected && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
            Set up SEC fund facts in{" "}
            <SettingsLink
              tab="integrations"
              section="sec"
              className="underline"
            />{" "}
            to see each fund&apos;s mix and expense ratio.
          </p>
        )}
        {view === "fund" ? (
          <div>
            <div className="text-caption text-faint mb-1 flex gap-x-3">
              <span className="flex-1">Fund · held in</span>
              <span className="w-24 text-right">Mix</span>
              <span className="w-16 text-right">Fee</span>
              <span className="w-14 text-right">Of total</span>
              <span className="w-24 text-right">Value</span>
            </div>
            {combineHoldings(data.accounts).map((f) => (
              <FundRow key={f.holding.securityId} f={f} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {data.accounts.map((a) => (
              <div key={a.simplefinAccountId}>
                <AccountHeader a={a} />
                {a.accountType !== null && isHsaCategory(a.accountType) && (
                  <HsaCashBuffer
                    ownerPersonId={a.ownerPersonId}
                    uninvestedCash={a.uninvestedCash}
                  />
                )}
                {a.holdings.map((h) => (
                  <HoldingRow key={h.securityId} h={h} editable={false} />
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationCard data={data} />
        <div className="space-y-4">
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
                {cost.coveredShare < FULL_SHARE && (
                  <p className="text-caption text-faint mt-1">
                    Covers {formatPercent(cost.coveredShare, 0)} of your money —
                    funds without a known expense ratio aren&apos;t included.
                  </p>
                )}
              </>
            )}
          </Card>
          <GlidePathCard data={data} />
        </div>
      </div>
    </div>
  );
}
