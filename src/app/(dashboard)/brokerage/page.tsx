"use client";

/** Displays taxable brokerage account balances, goals, and projection charts with permission-gated editing. */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { PlannedEventsTab } from "@/components/savings/planned-events-tab";
import { BrokerageGoalsSection } from "@/components/cards/brokerage-goals";
import {
  calculateBrokerageGoals,
  type BrokerageGoalYear,
  type BrokerageGoalStatus,
} from "@/lib/calculators/brokerage-goals";
import type { AccumOverride } from "@/components/cards/projection/types";
import type { AccountCategory } from "@/lib/calculators/types";
import {
  ALL_CATEGORIES,
  catDisplayLabel,
} from "@/components/cards/projection/utils";

type BrokerageTab = "projection" | "goals" | "transactions";

export default function BrokeragePage() {
  const user = useUser();
  const canEdit = hasPermission(user, "brokerage");
  const utils = trpc.useUtils();
  const salaryOverrides = useSalaryOverrides();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  // Brokerage lump sum overrides (one-time injections)
  const [brokerageLumpSums, setBrokerageLumpSums] = useState<
    BrokerageLumpSumEntry[]
  >([]);

  const accumOverridesFromLumpSums: AccumOverride[] = React.useMemo(() => {
    const byYear = new Map<number, AccumOverride>();
    for (const ls of brokerageLumpSums) {
      const y = parseInt(ls.year);
      const amt = parseFloat(ls.amount);
      if (isNaN(y) || isNaN(amt) || amt <= 0) continue;
      let ov = byYear.get(y);
      if (!ov) {
        ov = { year: y, lumpSums: [] };
        byYear.set(y, ov);
      }
      ov.lumpSums!.push({
        id: ls.id,
        amount: amt,
        targetAccount: ls.targetAccount,
        ...(ls.label ? { label: ls.label } : {}),
      });
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [brokerageLumpSums]);

  const engineInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(accumOverridesFromLumpSums.length > 0
      ? { accumulationOverrides: accumOverridesFromLumpSums }
      : {}),
  };
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];

  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
  const { data: contribData } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const { data: brokerageData } = trpc.brokerage.computeSummary.useQuery();

  const createTx = trpc.brokerage.plannedTransactions.create.useMutation({
    onSuccess: () => {
      utils.brokerage.computeSummary.invalidate();
      setAddingTx(false);
      setTxForm(emptyTxForm);
    },
  });
  const deleteTx = trpc.brokerage.plannedTransactions.delete.useMutation({
    onSuccess: () => utils.brokerage.computeSummary.invalidate(),
  });

  const [activeTab, setActiveTab] = useState<BrokerageTab>("projection");
  const [addingTx, setAddingTx] = useState(false);
  const [txForm, setTxForm] = useState(emptyTxForm);

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <div className="text-faint text-sm mt-8 text-center">
          Loading projection...
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <EmptyState message={`Failed to load: ${error.message}`} />
      </div>
    );
  }
  if (!data?.result) {
    return (
      <div>
        <PageHeader
          title="Brokerage Projection"
          subtitle="Non-retirement investment accounts"
        />
        <EmptyState message="No projection data available. Configure contribution accounts in Settings." />
      </div>
    );
  }

  // Run brokerage goals calculator on engine output
  const brokerageGoalsInput = {
    asOfDate: new Date(),
    goals: data.brokerageGoals ?? [],
    engineYears: data.result.projectionByYear,
    parentCategoryFilter: "Portfolio",
    plannedTransactions: brokerageData?.plannedTransactions,
  };
  const brokerageResult = calculateBrokerageGoals(brokerageGoalsInput);

  // Portfolio-category accounts from contribution summary (parentCategory filter)
  const portfolioAccounts = contribData
    ? [
        ...contribData.people.flatMap((p) =>
          p.accountTypes.filter((at) => at.parentCategory === "Portfolio"),
        ),
        ...(contribData.jointAccountTypes ?? []).filter(
          (at) => at.parentCategory === "Portfolio",
        ),
      ]
    : [];

  // Funding sources — fully separated from retirement engine data.
  // Direct contributions: sum of Portfolio-category accounts only (from contribution summary)
  const totalDirectContrib = portfolioAccounts.reduce(
    (s, at) => s + at.totalContrib,
    0,
  );

  // Overflow from retirement: the only thing that crosses from the engine
  const firstYear = brokerageResult.projectionByYear[0];
  const totalOverflow = firstYear?.overflow ?? 0;

  // Brokerage ramp from engine settings (shared global setting)
  const accYears = data.result.projectionByYear.filter(
    (yr) => yr.phase === "accumulation",
  );
  const firstAccYear = accYears[0] as
    | import("@/lib/calculators/types").EngineAccumulationYear
    | undefined;
  const brokerageRamp = firstAccYear?.brokerageRampContribution ?? 0;

  // Build goalById map for PlannedEventsTab
  const goalById = new Map(
    (brokerageData?.goals ?? []).map((g) => [g.id, { name: g.name }]),
  );

  const handleAddTx = () => {
    if (
      !txForm.goalId ||
      !txForm.transactionDate ||
      !txForm.amount ||
      !txForm.description
    )
      return;
    createTx.mutate({
      goalId: txForm.goalId,
      transactionDate: txForm.transactionDate,
      amount: txForm.amount,
      description: txForm.description,
      isRecurring: txForm.isRecurring,
      recurrenceMonths: txForm.isRecurring
        ? parseInt(txForm.recurrenceMonths) || null
        : null,
    });
  };

  const tabs: { key: BrokerageTab; label: string }[] = [
    { key: "projection", label: "Projection" },
    { key: "goals", label: "Goals" },
    { key: "transactions", label: "Transactions" },
  ];

  return (
    <div>
      <PageHeader
        title="Brokerage Projection"
        subtitle="Non-retirement investment accounts"
      />

      <div className="flex border-b mb-4 mt-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted hover:text-secondary hover:border-strong"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "projection" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Funding Sources */}
            <Card title="Funding Sources" className="lg:col-span-1">
              <FundingSources
                directContrib={totalDirectContrib}
                overflow={totalOverflow}
                ramp={brokerageRamp}
              />
            </Card>

            {/* By Account */}
            <Card title="By Account" className="lg:col-span-2">
              <ByAccountSummary accounts={portfolioAccounts} />
            </Card>
          </div>

          {/* Goal Status */}
          {brokerageResult.goals.length > 0 && (
            <Card title="Brokerage Goals" className="mt-6">
              <GoalStatusTable goals={brokerageResult.goals} />
            </Card>
          )}

          {/* Lump Sum Overrides */}
          {canEdit && (
            <Card title="Lump Sum Events" className="mt-6">
              <p className="text-xs text-muted mb-2">
                One-time dollar injections (bonus, inheritance, rollover).
                <HelpTip text="Lump sums bypass IRS contribution limits and are only applied in the specified year." />
              </p>
              {brokerageLumpSums.length > 0 && (
                <div className="space-y-1 mb-3">
                  {brokerageLumpSums.map((ls) => (
                    <div
                      key={ls.id}
                      className="flex items-center gap-2 bg-surface-sunken rounded px-3 py-1.5 text-xs"
                    >
                      <span className="font-semibold">{ls.year}</span>
                      <span>
                        +
                        {ls.amount
                          ? formatCurrency(parseFloat(ls.amount))
                          : "$0"}
                      </span>
                      <span className="text-muted">
                        →{" "}
                        {catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}
                      </span>
                      {ls.label && (
                        <span className="text-muted">({ls.label})</span>
                      )}
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-600 ml-auto"
                        onClick={() =>
                          setBrokerageLumpSums((prev) =>
                            prev.filter((x) => x.id !== ls.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <BrokerageLumpSumForm
                onAdd={(ls) => setBrokerageLumpSums((prev) => [...prev, ls])}
              />
            </Card>
          )}

          {/* Year-by-Year Projection */}
          <Card title="Year-by-Year Projection" className="mt-6">
            <YearByYearTable years={brokerageResult.projectionByYear} />
          </Card>
        </>
      )}

      {activeTab === "goals" && <BrokerageGoalsSection />}

      {activeTab === "transactions" && (
        <div className="space-y-4">
          {/* Add transaction form */}
          {canEdit &&
            (addingTx ? (
              <Card title="New Planned Transaction">
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={txForm.goalId ?? ""}
                      onChange={(e) =>
                        setTxForm({
                          ...txForm,
                          goalId: Number(e.target.value) || null,
                        })
                      }
                    >
                      <option value="">Select goal...</option>
                      {(brokerageData?.goals ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="border rounded px-2 py-1 text-sm"
                      type="date"
                      value={txForm.transactionDate}
                      onChange={(e) =>
                        setTxForm({
                          ...txForm,
                          transactionDate: e.target.value,
                        })
                      }
                    />
                    <input
                      className="border rounded px-2 py-1 text-sm"
                      placeholder="Amount (+ deposit, - withdrawal)"
                      value={txForm.amount}
                      onChange={(e) =>
                        setTxForm({ ...txForm, amount: e.target.value })
                      }
                    />
                    <input
                      className="border rounded px-2 py-1 text-sm"
                      placeholder="Description"
                      value={txForm.description}
                      onChange={(e) =>
                        setTxForm({ ...txForm, description: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={txForm.isRecurring}
                        onChange={(e) =>
                          setTxForm({
                            ...txForm,
                            isRecurring: e.target.checked,
                          })
                        }
                      />
                      Recurring
                    </label>
                    {txForm.isRecurring && (
                      <input
                        className="border rounded px-2 py-1 text-sm w-32"
                        placeholder="Every N months"
                        type="number"
                        value={txForm.recurrenceMonths}
                        onChange={(e) =>
                          setTxForm({
                            ...txForm,
                            recurrenceMonths: e.target.value,
                          })
                        }
                      />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddTx}
                      disabled={createTx.isPending}
                    >
                      {createTx.isPending ? "Adding..." : "Add Transaction"}
                    </Button>
                    <button
                      className="text-xs text-muted hover:text-secondary"
                      onClick={() => {
                        setAddingTx(false);
                        setTxForm(emptyTxForm);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Card>
            ) : (
              <button
                className="text-sm text-blue-600 hover:text-blue-800"
                onClick={() => setAddingTx(true)}
              >
                + Add Planned Transaction
              </button>
            ))}

          <PlannedEventsTab
            plannedTransactions={brokerageData?.plannedTransactions ?? []}
            goalById={goalById}
            onDeleteTx={(p) => deleteTx.mutate(p)}
            entityLabel="Goal"
            canEdit={canEdit}
          />
        </div>
      )}

      {/* Warnings */}
      {brokerageResult.warnings.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {brokerageResult.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Form state ---

const emptyTxForm = {
  goalId: null as number | null,
  transactionDate: "",
  amount: "",
  description: "",
  isRecurring: false,
  recurrenceMonths: "",
};

// --- Sub-components ---

function FundingSources({
  directContrib,
  overflow,
  ramp,
}: {
  directContrib: number;
  overflow: number;
  ramp: number;
}) {
  const total = directContrib + overflow + ramp;
  const rows = [
    {
      label: "Direct contributions",
      amount: directContrib,
      help: "Employee + employer contributions to Portfolio-category accounts",
    },
    {
      label: "Retirement overflow",
      amount: overflow,
      help: "Excess contributions that exceed IRS limits on retirement accounts, redirected here",
    },
    {
      label: "Brokerage ramp",
      amount: ramp,
      help: "Annual increase from Settings — same value used on Retirement page",
    },
  ];

  return (
    <div className="space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between">
          <span className="text-muted">
            {r.label}
            {r.help && <HelpTip text={r.help} />}
          </span>
          <span className="font-medium text-primary">
            {formatCurrency(r.amount)}/yr
          </span>
        </div>
      ))}
      <div className="border-t pt-2 flex justify-between font-semibold">
        <span className="text-secondary">Total inflow</span>
        <span className="text-primary">{formatCurrency(total)}/yr</span>
      </div>
    </div>
  );
}

function ByAccountSummary({
  accounts,
}: {
  accounts: {
    accountType: string;
    employeeContrib: number;
    employerMatch: number;
    totalContrib: number;
    targetAnnual: number | null;
    fundingPct: number;
    hasDiscountBar: boolean;
    employerMatchLabel: string;
  }[];
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-faint">
        No portfolio-category contribution accounts configured.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((at) => (
        <div key={at.accountType}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-secondary font-medium">{at.accountType}</span>
            <span className="text-primary font-semibold">
              {formatCurrency(at.totalContrib)}/yr
            </span>
          </div>
          {at.targetAnnual != null && at.targetAnnual > 0 && (
            <div className="mt-1">
              <div className="w-full bg-surface-strong rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (at.totalContrib / at.targetAnnual) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-faint mt-0.5">
                {Math.round((at.totalContrib / at.targetAnnual) * 100)}% of{""}
                {formatCurrency(at.targetAnnual)} target
              </p>
            </div>
          )}
          {at.targetAnnual == null && (
            <p className="text-[10px] text-faint mt-0.5">No target set</p>
          )}
          {at.employerMatch > 0 && (
            <p className="text-[10px] text-muted mt-0.5">
              +{formatCurrency(at.employerMatch)}/yr {at.employerMatchLabel}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function GoalStatusTable({ goals }: { goals: BrokerageGoalStatus[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint uppercase border-b">
            <th className="py-2 pr-4">Goal</th>
            <th className="py-2 pr-4 text-right">Target</th>
            <th className="py-2 pr-4 text-right">Year</th>
            <th className="py-2 pr-4 text-right">
              Projected Balance
              <HelpTip text="Estimated brokerage balance at target year, before the goal withdrawal" />
            </th>
            <th className="py-2 pr-4 text-right">Withdrawal</th>
            <th className="py-2 pr-4 text-right">
              Tax Cost
              <HelpTip text="Estimated capital gains tax on the gains portion of the withdrawal — basis (contributions) is tax-free" />
            </th>
            <th className="py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr key={g.id} className="border-b border-subtle">
              <td className="py-2 pr-4 font-medium text-secondary">{g.name}</td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.targetAmount)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {g.targetYear}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.projectedBalance)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.actualWithdrawal)}
              </td>
              <td className="py-2 pr-4 text-right text-muted">
                {formatCurrency(g.taxCost)}
              </td>
              <td className="py-2 text-center">
                {g.funded ? (
                  <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
                    Funded
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                    {formatCurrency(g.shortfall)} short
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearByYearTable({ years }: { years: BrokerageGoalYear[] }) {
  if (years.length === 0) {
    return <p className="text-sm text-faint">No projection data.</p>;
  }

  const hasAnyPlanned = years.some((yr) => yr.plannedTransactionTotal !== 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-primary z-10">
          <tr className="text-left text-[10px] text-faint uppercase border-b">
            <th className="py-2 pr-3">Year</th>
            <th className="py-2 pr-3 text-right">
              Contribution
              <HelpTip text="Intentional brokerage contributions (employee + employer match)" />
            </th>
            <th className="py-2 pr-3 text-right">
              Overflow
              <HelpTip text="Excess from retirement accounts that exceed IRS limits, redirected to brokerage" />
            </th>
            {hasAnyPlanned && (
              <th className="py-2 pr-3 text-right">
                Planned
                <HelpTip text="Manual planned deposits or withdrawals from the Transactions tab" />
              </th>
            )}
            <th className="py-2 pr-3 text-right">
              Growth
              <HelpTip text="Investment returns — balance change minus net contributions and withdrawals" />
            </th>
            <th className="py-2 pr-3 text-right">
              Withdrawals
              <HelpTip text="Goal withdrawals processed by the engine in target year" />
            </th>
            <th className="py-2 pr-3 text-right">
              Tax Cost
              <HelpTip text="Capital gains tax on the gains portion of withdrawals — basis is tax-free" />
            </th>
            <th className="py-2 pr-3 text-right">
              End Balance
              <HelpTip text="Total brokerage account value at year end" />
            </th>
            <th className="py-2 pr-3 text-right">
              Cost Basis
              <HelpTip text="Cumulative contributions — the tax-free portion of the balance" />
            </th>
            <th className="py-2 text-right">
              Unrealized Gain
              <HelpTip text="Balance minus cost basis — the portion subject to capital gains tax if withdrawn" />
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((yr) => {
            const hasWithdrawals = yr.totalWithdrawal > 0;
            return (
              <tr
                key={yr.year}
                className={`border-b border-subtle ${
                  hasWithdrawals ? "bg-amber-50/50" : ""
                }`}
              >
                <td className="py-1.5 pr-3 font-medium text-secondary">
                  {yr.year}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.contribution > 0
                    ? formatCurrency(yr.contribution)
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-amber-600">
                  {yr.overflow > 0 ? formatCurrency(yr.overflow) : "\u2014"}
                </td>
                {hasAnyPlanned && (
                  <td
                    className={`py-1.5 pr-3 text-right ${yr.plannedTransactionTotal >= 0 ? "text-blue-600" : "text-red-600"}`}
                  >
                    {yr.plannedTransactionTotal !== 0
                      ? `${yr.plannedTransactionTotal >= 0 ? "+" : ""}${formatCurrency(yr.plannedTransactionTotal)}`
                      : "\u2014"}
                  </td>
                )}
                <td className="py-1.5 pr-3 text-right text-emerald-600">
                  {yr.growth !== 0 ? formatCurrency(yr.growth) : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-red-600">
                  {yr.totalWithdrawal > 0
                    ? `-${formatCurrency(yr.totalWithdrawal)}`
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {yr.totalTaxCost > 0
                    ? formatCurrency(yr.totalTaxCost)
                    : "\u2014"}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium text-primary">
                  {formatCurrency(yr.endBalance)}
                </td>
                <td className="py-1.5 pr-3 text-right text-muted">
                  {formatCurrency(yr.endBasis)}
                </td>
                <td className="py-1.5 text-right text-muted">
                  {formatCurrency(yr.unrealizedGain)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type BrokerageLumpSumEntry = {
  id: string;
  year: string;
  amount: string;
  targetAccount: AccountCategory;
  label: string;
};

function BrokerageLumpSumForm({
  onAdd,
}: {
  onAdd: (ls: BrokerageLumpSumEntry) => void;
}) {
  const [form, setForm] = useState<Omit<BrokerageLumpSumEntry, "id">>({
    year: String(new Date().getFullYear() + 1),
    amount: "",
    targetAccount: "brokerage" as AccountCategory,
    label: "",
  });

  return (
    <div className="grid grid-cols-[80px_1fr_1fr_1fr_auto] gap-2 items-end text-sm">
      <label className="block">
        <span className="text-[10px] text-muted">Year</span>
        <input
          type="number"
          value={form.year}
          onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-muted">Amount</span>
        <input
          type="number"
          min={0}
          placeholder="$50,000"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-muted">Account</span>
        <select
          value={form.targetAccount}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              targetAccount: e.target.value as AccountCategory,
            }))
          }
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        >
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {catDisplayLabel[cat] ?? cat}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] text-muted">Label</span>
        <input
          type="text"
          placeholder="Bonus"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          if (!form.amount || parseFloat(form.amount) <= 0) return;
          onAdd({ ...form, id: crypto.randomUUID() });
          setForm((f) => ({ ...f, amount: "", label: "" }));
        }}
        className="bg-emerald-600 text-white text-xs rounded px-3 py-1.5 hover:bg-emerald-700"
      >
        Add
      </button>
    </div>
  );
}
