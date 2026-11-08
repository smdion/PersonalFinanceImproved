/** The Brokerage page's cost basis editor, funding sources and per-account summary. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
  budgetApiServiceLabel,
} from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";

// --- Sub-components ---

/** Cost basis for Portfolio-category brokerage accounts — the accounts Tax
 *  Buckets deliberately excludes (its scope is Retirement-category holdings
 *  only), so this is their one home for basis editing. Reuses
 *  performance.updateCostBasis, the same mutation the Performance page's
 *  inline account-table editor calls. */
export function CostBasisEditor({
  accounts,
  canEdit,
  onSave,
}: {
  accounts: {
    id: number;
    accountLabel: string;
    displayName: string | null;
    costBasis: string;
    accountType?: string;
    institution?: string;
    ownershipType?: string | null;
  }[];
  canEdit: boolean;
  onSave: (performanceAccountId: number, costBasis: string) => void;
}) {
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a.costBasis])),
  );

  return (
    <div className="space-y-3">
      <p className="text-caption text-muted">
        What you originally paid for these holdings — the portion you can
        withdraw without triggering capital gains tax. Only the growth above
        this amount is taxable when sold.
      </p>
      {accounts.map((a) => (
        <div
          key={a.id}
          className="border-subtle flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
        >
          <span className="text-sm font-medium">{accountDisplayName(a)}</span>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="border-subtle bg-surface w-32 rounded border px-2 py-1 text-right text-sm"
                value={values[a.id] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [a.id]: e.target.value }))
                }
              />
              <button
                className="bg-primary rounded px-3 py-1 text-sm text-white"
                onClick={() => onSave(a.id, values[a.id] || "0")}
              >
                Save
              </button>
            </div>
          ) : (
            <span className="text-sm tabular-nums">
              {formatCurrency(Number(a.costBasis))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function FundingSources({
  directContrib,
  overflow,
  ramp,
  canEdit,
  onRampChange,
}: {
  directContrib: number;
  overflow: number;
  ramp: number;
  canEdit: boolean;
  onRampChange: (value: number) => void;
}) {
  const total = directContrib + overflow + ramp;
  const rows = [
    {
      label: "Direct contributions",
      amount: directContrib,
      help: "Employee + employer contributions to Portfolio-category accounts",
    },
    // Contributions over the IRS limits go to retirement accounts; they
    // reach a Portfolio account only when there's no retirement brokerage.
    ...(overflow > 0
      ? [
          {
            label: "Retirement overflow",
            amount: overflow,
            help: "Contributions over the IRS limits on retirement accounts. They normally go to a Retirement brokerage; they land here because you have none.",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between">
          <span className="text-muted">
            {r.label}
            {r.help && <HelpTip text={r.help} />}
          </span>
          <span className="text-primary font-medium">
            {formatCurrency(r.amount)}/yr
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <span className="text-muted">
          Annual increase
          <HelpTip text="Additional fixed-dollar contribution added each year (e.g., $50/yr means year 1 adds $50, year 2 adds $100, etc.)" />
        </span>
        {canEdit ? (
          <span className="flex items-center gap-1">
            <span className="text-faint">$</span>
            <input
              type="number"
              min={0}
              step={10}
              defaultValue={ramp}
              className="w-20 rounded border px-1.5 py-0.5 text-right text-sm"
              onBlur={(e) => {
                const value = parseFloat(e.target.value) || 0;
                if (value !== ramp) onRampChange(value);
              }}
            />
            <span className="text-faint text-xs">/yr</span>
          </span>
        ) : (
          <span className="text-primary font-medium">
            {formatCurrency(ramp)}/yr
          </span>
        )}
      </div>
      <div className="flex justify-between border-t pt-2 font-semibold">
        <span className="text-secondary">Total inflow</span>
        <span className="text-primary">{formatCurrency(total)}/yr</span>
      </div>
    </div>
  );
}

type ApiBalanceInfo = {
  performanceAccountId: number;
  accountCategory: string;
  resolvedBalance: number;
  snapshotBalance: number;
  source: "api" | "snapshot";
};

export function ByAccountSummary({
  accounts,
  apiBalances,
  budgetLinks,
}: {
  accounts: {
    accountType: string;
    categoryKey: string;
    /** The tracked accounts this row adds up. */
    performanceAccountIds: number[];
    employeeContrib: number;
    employerMatch: number;
    totalContrib: number;
    targetAnnual: number | null;
    views: Record<
      string,
      {
        fundingPct: number;
        fundingMissing: number;
        pctOfSalaryToMax: number | null;
      }
    >;
    hasDiscountBar: boolean;
    employerMatchLabel: string;
  }[];
  apiBalances: ApiBalanceInfo[];
  budgetLinks: Array<{
    performanceAccountId: number | null;
    accountType: string;
    budgetItemName: string;
    budgetCategory: string;
  }>;
}) {
  const { data: activeBudgetApi } = trpc.sync.getActiveBudgetApi.useQuery();
  if (accounts.length === 0) {
    return (
      <p className="text-faint text-sm">
        No portfolio-category contribution accounts configured.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((at) => {
        // This row's own tracked accounts — never every account of its type.
        const mine = (id: number | null) =>
          id !== null && at.performanceAccountIds.includes(id);
        const rowApi = apiBalances.filter((ab) =>
          mine(ab.performanceAccountId),
        );
        const apiInfo =
          rowApi.length > 0
            ? {
                resolvedBalance: sumBy(rowApi, (ab) => ab.resolvedBalance),
                snapshotBalance: sumBy(rowApi, (ab) => ab.snapshotBalance),
              }
            : null;
        const linkNames = budgetLinks
          .filter((bl) => mine(bl.performanceAccountId))
          .map((bl) => bl.budgetItemName);
        return (
          <div key={at.accountType}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-secondary font-medium">
                {at.accountType}
                {apiInfo && (
                  <Badge color="blue" className="ml-1.5">
                    {budgetApiServiceLabel(activeBudgetApi)}
                  </Badge>
                )}
              </span>
              <span className="text-primary font-semibold">
                {apiInfo
                  ? formatCurrency(apiInfo.resolvedBalance)
                  : `${formatCurrency(at.totalContrib)}/yr`}
              </span>
            </div>
            {linkNames.length > 0 && (
              <p className="text-caption mt-0.5 text-emerald-600">
                Linked to budget: {linkNames.join(", ")}
              </p>
            )}
            {apiInfo && (
              <p className="text-caption mt-0.5 text-blue-600">
                Balance from {budgetApiServiceLabel(activeBudgetApi)} (snapshot:{" "}
                {formatCurrency(apiInfo.snapshotBalance)})
              </p>
            )}
            {at.targetAnnual != null && at.targetAnnual > 0 && (
              <div className="mt-1">
                <div className="bg-surface-strong h-2 w-full rounded-full">
                  <div
                    className="h-2 rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(100, (at.totalContrib / at.targetAnnual) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-caption text-faint mt-0.5">
                  {/* lint-violation-ok: guarded by at.targetAnnual > 0 above */}
                  {formatPercent(at.totalContrib / at.targetAnnual)} of{" "}
                  {formatCurrency(at.targetAnnual)} target
                </p>
              </div>
            )}
            {at.targetAnnual == null && (
              <p className="text-caption text-faint mt-0.5">No target set</p>
            )}
            {at.employerMatch > 0 && (
              <p className="text-caption text-muted mt-0.5">
                +{formatCurrency(at.employerMatch)}/yr {at.employerMatchLabel}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
