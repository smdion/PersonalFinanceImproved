"use client";

/** Multi-panel summary of the latest portfolio snapshot — balances grouped by
 *  account type, institution, person, tax bucket, plus a per-account bar chart. */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  accountDisplayName,
  personDisplayName,
} from "@/lib/utils/format";
import { trpc } from "@/lib/trpc";
import { taxTypeLabel, accountColor } from "@/lib/utils/colors";
import {
  ACCOUNT_TYPE_CONFIG,
  type AccountCategory,
} from "@/lib/config/account-types";
import { SummaryTable } from "./summary-table";

export function AccountBalanceOverview() {
  const { data: latestSnap } =
    trpc.settings.portfolioSnapshots.getLatest.useQuery();
  const { data: perfAccounts } =
    trpc.settings.performanceAccounts.list.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();

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
    const byPersonTaxType = new Map<string, number>();
    for (const a of accounts) {
      const name = personDisplayName(a.ownerPersonId, peopleMap);
      const taxLabel = taxTypeLabel(a.taxType);
      const key = `${name} ${taxLabel}`;
      byPersonTaxType.set(key, (byPersonTaxType.get(key) ?? 0) + a.amt);
    }
    const personDetailRows = Array.from(byPersonTaxType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => ({ label, amount: amt }));

    // --- Per Person (totals) ---
    const byPerson = new Map<string, number>();
    for (const a of accounts) {
      const name = personDisplayName(a.ownerPersonId, peopleMap);
      byPerson.set(name, (byPerson.get(name) ?? 0) + a.amt);
    }
    const personRows = Array.from(byPerson.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amt]) => ({ label: name, amount: amt }));

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
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold text-secondary">
          Account Balances
        </h3>
        <span className="text-sm font-bold text-primary">
          {formatCurrency(portfolioTotal)}
        </span>
      </div>

      {/* Summary panels grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
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
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 min-w-0">
          <SummaryTable
            title="Per Person Detail"
            rows={personDetailRows}
            total={portfolioTotal}
            showPct
          />
        </div>

        <div className="lg:col-span-3">
          <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            By Account
          </h4>
          <div className="space-y-2">
            {activeAccounts.map((pa) => {
              const balance = balanceByPerfId.get(pa.id) ?? 0;
              const pct = (balance / maxBalance) * 100;
              return (
                <div key={pa.id} className="flex items-center gap-3">
                  <div className="w-[260px] shrink-0 text-xs text-muted truncate">
                    {accountDisplayName(pa)}
                  </div>
                  <div className="flex-1 h-4 bg-surface-elevated rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${accountColor(pa.accountType)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-[90px] text-right text-xs font-medium text-secondary">
                    {formatCurrency(balance)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
