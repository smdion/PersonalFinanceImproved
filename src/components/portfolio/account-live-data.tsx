"use client";

/**
 * What SimpleFIN knows about one tracked account, inside its card in
 * Account & Contribution Settings: link status and live balance, the funds
 * it holds (with the household's fund-fact controls), its asset mix and
 * yearly fee, and whether deposits match the paycheck setup.
 */
import { type RouterOutputs } from "@/lib/trpc";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import {
  BUCKET_COLORS,
  HoldingRow,
  type Holding,
} from "@/components/investments/fund-holding-row";

export type AccountInsight =
  RouterOutputs["investments"]["getAccountInsights"][number];

const day = (d: string) => formatDate(d, "medium");

/** One line under the account's name: live balance and link status. */
export function AccountLiveSummary({ insight }: { insight: AccountInsight }) {
  if (insight.status === "none")
    return <span className="text-faint">Not linked to SimpleFIN</span>;
  return (
    <span className="text-faint">
      Live {formatCurrency(insight.live?.total ?? 0)}
      {insight.live?.asOf && ` · ${day(insight.live.asOf)}`}
      {insight.status === "balance_only" && " · balance only"}
      {insight.unlinkedParts.length > 0 && (
        <span className="text-amber-600"> · partly linked</span>
      )}
    </span>
  );
}

function AccountMixBar({
  buckets,
  total,
}: {
  buckets: Record<CompositionBucket, number>;
  total: number;
}) {
  const parts = COMPOSITION_BUCKET_VALUES.filter((b) => buckets[b] > 0.005);
  if (total <= 0 || parts.length === 0) return null;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded">
        {parts.map((b) => (
          <div
            key={b}
            style={{
              width: `${safeDivide(buckets[b], total) * 100}%`,
              background: BUCKET_COLORS[b],
            }}
          />
        ))}
      </div>
      <div className="text-caption text-muted mt-1 flex flex-wrap gap-x-3">
        {parts.map((b) => (
          <span key={b} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: BUCKET_COLORS[b] }}
            />
            {COMPOSITION_BUCKET_LABELS[b]}{" "}
            {formatPercent(safeDivide(buckets[b], total), 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DepositCheck({ d }: { d: AccountInsight["deposits"] }) {
  const pace =
    d.typical !== null && d.everyDays !== null
      ? `${formatCurrency(d.typical)} about every ${d.everyDays} days`
      : null;
  const message = (() => {
    switch (d.verdict) {
      case "matches":
        return {
          warn: false,
          text: `Deposits match your paycheck setup: about ${formatCurrency(d.observedAnnual ?? 0)} a year (${pace}).`,
        };
      case "lower":
      case "higher":
        return {
          warn: true,
          text: `Deposits run about ${formatCurrency(d.observedAnnual ?? 0)} a year (${pace}); your paycheck setup says ${formatCurrency(d.expectedAnnual ?? 0)}. Check the contribution amounts below, or your plan.`,
        };
      case "no_setup":
        return {
          warn: true,
          text: `Deposits arrive here${d.observedAnnual ? ` (about ${formatCurrency(d.observedAnnual)} a year, ${pace})` : ""}, but no contribution is set up for this account — add one below so plans include it.`,
        };
      case "no_deposits":
        return {
          warn: true,
          text: `Your paycheck setup sends about ${formatCurrency(d.expectedAnnual ?? 0)} a year here, but no deposits arrived in the last 90 days.`,
        };
      case "too_few":
        return {
          warn: false,
          text: `${d.paydays} deposit${d.paydays === 1 ? "" : "s"} so far — too few to compare with your setup yet.`,
        };
      case "unknown":
        return d.expectedAnnual
          ? {
              warn: false,
              text: "SimpleFIN doesn't send transactions for this account, so deposits can't be checked.",
            }
          : null;
      default:
        return null;
    }
  })();
  if (!message && d.recent.length === 0) return null;
  return (
    <div className="text-xs">
      {message && (
        <p
          className={
            message.warn ? "text-amber-700 dark:text-amber-400" : "text-muted"
          }
        >
          {message.text}
        </p>
      )}
      {d.recent.length > 0 && (
        <p className="text-caption text-faint mt-0.5">
          Latest:{" "}
          {d.recent
            .map((r) => `${formatCurrency(r.amount)} on ${day(r.day)}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export function AccountLiveSection({
  insight,
  holdings,
}: {
  insight: AccountInsight | undefined;
  holdings: Holding[];
}) {
  if (!insight)
    return (
      <p className="text-caption text-faint">
        Not linked to SimpleFIN — link it in Settings → Integrations to see live
        balances, holdings and deposits here.
      </p>
    );
  const { mix, cost } = insight;
  return (
    <div className="space-y-3">
      <div className="text-xs">
        {insight.status === "none" ? (
          <p className="text-faint">
            Not linked to SimpleFIN — link it in Settings → Integrations.
          </p>
        ) : (
          <p className="text-muted">
            Live balance{" "}
            <span className="text-primary font-medium">
              {formatCurrency(insight.live?.total ?? 0)}
            </span>
            {insight.live?.asOf && ` as of ${day(insight.live.asOf)}`} from{" "}
            {insight.feeds
              .map((f) => (f.part ? `${f.name} (${f.part})` : f.name))
              .join(", ")}
            {insight.status === "balance_only" &&
              " — the institution sends only a balance, no transactions"}
            .
          </p>
        )}
        {insight.unplaced.map((u) => (
          <p key={u.name} className="mt-0.5 text-amber-700 dark:text-amber-400">
            {formatCurrency(u.balance)} in {u.name} isn&apos;t held by any part
            of this account
            {u.reason === "part_gone"
              ? " (it's linked to a part no longer in your snapshot)"
              : ""}
            , so snapshots leave it out — add the part under Sub-accounts below,
            then link it in Settings → Integrations.
          </p>
        ))}
        {insight.unlinkedParts.length > 0 && (
          <p className="mt-0.5 text-amber-700 dark:text-amber-400">
            Not linked yet: {insight.unlinkedParts.join(", ")} — link them in
            Settings → Integrations.
          </p>
        )}
      </div>

      {holdings.length > 0 && (
        <div>
          <div className="text-caption text-muted mb-1 flex flex-wrap items-baseline justify-between gap-2 font-semibold tracking-wider uppercase">
            <span>Holdings</span>
            {cost.expenseRatio !== null && (
              <span className="font-normal tracking-normal normal-case">
                Blended fee{" "}
                {formatPercent(
                  cost.expenseRatio,
                  cost.expenseRatio < 0.001 ? 3 : 2,
                )}{" "}
                ≈ {formatCurrency(cost.yearlyCost)} a year
                {cost.coveredShare < 0.995 &&
                  ` (for ${formatPercent(cost.coveredShare, 0)} of the account)`}
              </span>
            )}
          </div>
          <AccountMixBar buckets={mix.buckets} total={mix.total} />
          <div className="mt-2">
            {holdings.map((h) => (
              <HoldingRow key={h.securityId} h={h} editable />
            ))}
          </div>
        </div>
      )}

      <DepositCheck d={insight.deposits} />
    </div>
  );
}
