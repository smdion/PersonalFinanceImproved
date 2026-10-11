"use client";

/** Multi-panel summary of the latest portfolio snapshot — balances grouped by
 *  account type, institution, person, tax bucket, plus a per-account bar chart. */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
  personDisplayName,
} from "@/lib/utils/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { COMPOSITION_BUCKET_LABELS } from "@/lib/config/display-labels";
import { taxTypeLabel, accountColor } from "@/lib/utils/colors";
import {
  ACCOUNT_TYPE_CONFIG,
  type AccountCategory,
} from "@/lib/config/account-types";
import { SummaryTable } from "./summary-table";

export function AccountBalanceOverview() {
  const { data: latestSnap } =
    trpc.networth.portfolioSnapshots.getLatest.useQuery();
  const { data: perfAccounts } =
    trpc.performance.performanceAccounts.list.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();
  // Hidden (no error) without the portfolio permission it needs.
  const { data: holdings } = trpc.investments.getHoldingsOverview.useQuery(
    undefined,
    { retry: false },
  );

  // Memoize all derived breakdowns from snapshot data. Hooks must be called
  // before any early return to preserve hook order.
  const overviewData = useMemo(() => {
    if (!latestSnap?.accounts || !perfAccounts || !people) return null;

    // Parse all snapshot accounts into numbers once
    const accounts = latestSnap.accounts.map((a) => ({
      ...a,
      amt: parseFloat(a.amount),
    }));

    const portfolioTotal = accounts.reduce((s, a) => s + a.amt, 0);
    if (portfolioTotal === 0) return null;

    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

    // --- By Account Type ---
    const byAccountType = new Map<string, number>();
    for (const a of accounts) {
      const pa = a.performanceAccountId
        ? perfMap.get(a.performanceAccountId)
        : null;
      const cat = pa?.accountType ?? a.accountType;
      byAccountType.set(cat, (byAccountType.get(cat) ?? 0) + a.amt);
    }
    const accountTypeRows = Array.from(byAccountType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => ({
        label: ACCOUNT_TYPE_CONFIG[cat as AccountCategory]?.displayLabel ?? cat,
        amount: amt,
      }));

    // --- By Institution ---
    const byInstitution = new Map<string, number>();
    for (const a of accounts) {
      byInstitution.set(
        a.institution,
        (byInstitution.get(a.institution) ?? 0) + a.amt,
      );
    }
    const institutionRows = Array.from(byInstitution.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([inst, amt]) => ({ label: inst, amount: amt }));

    // --- Per Person (detail: person + taxType) ---
    // Keyed by raw ownerPersonId (not the rendered display name) — person
    // names have no DB uniqueness constraint, so two different people could
    // collide onto the same string key.
    const byPersonTaxType = new Map<string, { name: string; amount: number }>();
    for (const a of accounts) {
      const name = personDisplayName(a.ownerPersonId, peopleMap);
      const taxLabel = taxTypeLabel(a.taxType);
      const key = `${a.ownerPersonId ?? "null"}:${a.taxType}`;
      const existing = byPersonTaxType.get(key);
      const label = `${name} ${taxLabel}`;
      byPersonTaxType.set(key, {
        name: label,
        amount: (existing?.amount ?? 0) + a.amt,
      });
    }
    const personDetailRows = Array.from(byPersonTaxType.values())
      .sort((a, b) => b.amount - a.amount)
      .map(({ name, amount }) => ({ label: name, amount }));

    // --- Per Person (totals) ---
    const byPerson = new Map<
      string | number,
      { name: string; amount: number }
    >();
    for (const a of accounts) {
      const name = personDisplayName(a.ownerPersonId, peopleMap);
      const key = a.ownerPersonId ?? "null";
      const existing = byPerson.get(key);
      byPerson.set(key, {
        name,
        amount: (existing?.amount ?? 0) + a.amt,
      });
    }
    const personRows = Array.from(byPerson.values())
      .sort((a, b) => b.amount - a.amount)
      .map(({ name, amount }) => ({ label: name, amount }));

    // --- By Tax Bucket ---
    const byTaxType = new Map<string, number>();
    for (const a of accounts) {
      const label = taxTypeLabel(a.taxType);
      byTaxType.set(label, (byTaxType.get(label) ?? 0) + a.amt);
    }
    const taxRows = Array.from(byTaxType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => ({ label, amount: amt }));

    // --- Per-Account bar chart (original view) ---
    const balanceByPerfId = new Map<number, number>();
    for (const a of accounts) {
      if (a.performanceAccountId) {
        balanceByPerfId.set(
          a.performanceAccountId,
          (balanceByPerfId.get(a.performanceAccountId) ?? 0) + a.amt,
        );
      }
    }
    const activeAccounts = perfAccounts
      .filter((pa) => pa.isActive && balanceByPerfId.has(pa.id))
      .sort(
        (a, b) =>
          (balanceByPerfId.get(b.id) ?? 0) - (balanceByPerfId.get(a.id) ?? 0),
      );
    const maxBalance = Math.max(
      ...activeAccounts.map((pa) => balanceByPerfId.get(pa.id) ?? 0),
      1,
    );

    return {
      portfolioTotal,
      accountTypeRows,
      institutionRows,
      personDetailRows,
      personRows,
      taxRows,
      activeAccounts,
      balanceByPerfId,
      maxBalance,
    };
  }, [latestSnap, perfAccounts, people]);

  if (!overviewData) return null;

  const {
    portfolioTotal,
    accountTypeRows,
    institutionRows,
    personDetailRows,
    personRows,
    taxRows,
    activeAccounts,
    balanceByPerfId,
    maxBalance,
  } = overviewData;

  return (
    <Card className="mt-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-secondary text-sm font-semibold">
          Account Balances
        </h3>
        <span className="text-primary text-sm font-bold">
          {formatCurrency(portfolioTotal)}
        </span>
      </div>

      {/* Summary panels grid */}
      <div className="mb-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <SummaryTable
          title="By Account Type"
          rows={accountTypeRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="By Institution"
          rows={institutionRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="Per Person"
          rows={personRows}
          total={portfolioTotal}
          showPct
        />
        <SummaryTable
          title="Tax Bucket"
          rows={taxRows}
          total={portfolioTotal}
          showPct
        />
      </div>

      {/* Row 2: Per-person detail + per-account bar chart side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="min-w-0 lg:col-span-1">
          <SummaryTable
            title="Per Person Detail"
            rows={personDetailRows}
            total={portfolioTotal}
            showPct
          />
        </div>

        <div className="lg:col-span-3">
          <h4 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
            By Account
          </h4>
          <div className="space-y-2">
            {activeAccounts.map((pa) => {
              const balance = balanceByPerfId.get(pa.id) ?? 0;
              const pct = (balance / maxBalance) * 100;
              return (
                <div key={pa.id} className="flex items-center gap-3">
                  <div className="text-muted w-28 min-w-0 shrink truncate text-xs md:w-[260px]">
                    {accountDisplayName(pa)}
                  </div>
                  <div className="bg-surface-elevated h-4 flex-1 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full ${accountColor(pa.accountType)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-secondary w-[70px] shrink-0 text-right text-xs font-medium md:w-[90px]">
                    {formatCurrency(balance)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {holdings && holdings.allocation.total > 0 && (
        <MixAndCost data={holdings} />
      )}
    </Card>
  );
}

/** Reported holdings by asset class, and what the funds cost a year. */
function MixAndCost({
  data,
}: {
  data: RouterOutputs["investments"]["getHoldingsOverview"];
}) {
  const { allocation, cost } = data;
  const rows = [
    ...allocation.rows
      .filter((r) => r.value > 0.005)
      .map((r) => ({ label: r.name, amount: r.value })),
    ...allocation.unmapped.map((u) => ({
      label: COMPOSITION_BUCKET_LABELS[u.bucket],
      amount: u.value,
    })),
    ...(allocation.unknown > 0.005
      ? [{ label: "Mix not known yet", amount: allocation.unknown }]
      : []),
  ];
  return (
    <div className="border-subtle mt-6 grid grid-cols-1 gap-6 border-t pt-4 lg:grid-cols-4">
      <div className="lg:col-span-2">
        <SummaryTable
          title="By Asset Class (holdings SimpleFIN reports)"
          rows={rows}
          total={allocation.total}
          showPct
        />
      </div>
      <div className="lg:col-span-2">
        <h4 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          What the Funds Cost
        </h4>
        {cost.expenseRatio === null ? (
          <p className="text-faint text-xs">
            No fund fees known yet — set up SEC fund facts in Settings →
            Integrations, or enter a fund&apos;s fee in its account below.
          </p>
        ) : (
          <div className="space-y-1 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">Blended yearly fee</span>
              <span className="text-primary font-medium tabular-nums">
                {formatPercent(
                  cost.expenseRatio,
                  cost.expenseRatio < 0.001 ? 3 : 2,
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">About a year</span>
              <span className="text-primary font-medium tabular-nums">
                {formatCurrency(cost.yearlyCost)}
              </span>
            </div>
            {cost.coveredShare < 0.995 && (
              <p className="text-caption text-faint">
                Fee known for {formatPercent(cost.coveredShare, 0)} of holdings
                — open an account below to enter the rest.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
