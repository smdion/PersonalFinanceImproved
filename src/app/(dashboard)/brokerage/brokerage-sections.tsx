import type { DollarBasis } from "@/lib/config/enum-values";
import React from "react";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { maskAmountsInText } from "@/lib/utils/format";
import { YearByYearTable } from "./brokerage-year-table";
import { investedAtStartOf } from "@/lib/pure/advice/goldilocks";
import { BrokerageGoalsSection } from "@/app/(dashboard)/brokerage/brokerage-goals";
import {
  LumpSumForm,
  LumpSumBadge,
} from "@/components/retirement-projection/lump-sum-form";
import { isPortfolioParent } from "@/lib/config/account-types";
import { GoalStatusTable } from "./brokerage-goal-status";
import type { LumpSumEvent } from "@/components/retirement-projection/types";
import type { trpc, RouterOutputs } from "@/lib/trpc";
import type { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import {
  CostBasisEditor,
  FundingSources,
  ByAccountSummary,
} from "./brokerage-funding";

export type BrokerageYearSectionProps = {
  brokerageResult: ReturnType<typeof calculateBrokerageGoals>;
  deflate: (value: number, year: number) => number;
  dollarMode: DollarBasis;
  setDollarMode: React.Dispatch<React.SetStateAction<DollarBasis>>;
};

/** The year-by-year projection card, with its dollar toggle, and the warnings. */
export function BrokerageYearSection({
  brokerageResult,
  deflate,
  dollarMode,
  setDollarMode,
}: BrokerageYearSectionProps) {
  return (
    <>
      <Card title="Year-by-Year Projection" className="mt-6">
        <div className="mb-3 flex items-center justify-end">
          <div className="bg-surface-primary inline-flex rounded-md border p-0.5">
            {(
              [
                ["nominal", "Future $"],
                ["real", "Today's $"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDollarMode(key)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  dollarMode === key
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <HelpTip text="Future $ shows projected nominal values. Today's $ adjusts for inflation so you can compare in current purchasing power." />
        </div>
        <YearByYearTable
          years={brokerageResult.projectionByYear}
          deflate={deflate}
        />
      </Card>

      {/* Warnings */}
      {brokerageResult.warnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          {brokerageResult.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              {maskAmountsInText(w)}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

export type BrokerageGoalsPanelProps = {
  brokerageLumpSums: LumpSumEvent[];
  brokerageResult: ReturnType<typeof calculateBrokerageGoals>;
  canEdit: boolean;
  data: NonNullable<RouterOutputs["projection"]["computeProjection"]> & {
    result: NonNullable<
      NonNullable<RouterOutputs["projection"]["computeProjection"]>["result"]
    >;
  };
  isGoalsOpen: boolean;
  setBrokerageLumpSums: (
    updater: LumpSumEvent[] | ((prev: LumpSumEvent[]) => LumpSumEvent[]),
  ) => void;
  setIsGoalsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

/** Goal funding status, the goals editor and the planned events. */
export function BrokerageGoalsPanel({
  brokerageLumpSums,
  brokerageResult,
  canEdit,
  data,
  isGoalsOpen,
  setBrokerageLumpSums,
  setIsGoalsOpen,
}: BrokerageGoalsPanelProps) {
  return (
    <>
      {/* Goal Funding Status */}
      {brokerageResult.goals.length > 0 && (
        <Card title="Goal Funding Status" className="mt-6">
          <p className="text-muted mb-2 text-xs">
            Set a target amount and year — the engine withdraws from brokerage
            when the target year arrives and shows whether you are on track.
            <HelpTip text="Goals are automatic: the projection engine deducts the target amount from your brokerage balance in the target year. If the balance is insufficient, the shortfall is shown." />
          </p>
          <GoalStatusTable goals={brokerageResult.goals} />
        </Card>
      )}

      {/* Manage Goals (collapsible) */}
      {canEdit && (
        <div className="mt-6 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
                Manage Goals
              </h4>
              <HelpTip text="Create, edit, or delete brokerage goals. Each goal defines a target amount and year — the engine automatically withdraws from your brokerage in that year." />
            </div>
            <button
              type="button"
              onClick={() => setIsGoalsOpen(!isGoalsOpen)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                isGoalsOpen
                  ? "bg-surface-strong text-muted hover:text-primary"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {isGoalsOpen ? "Done" : "Edit Goals"}
            </button>
          </div>
          {isGoalsOpen && (
            <div className="mt-3">
              <BrokerageGoalsSection />
            </div>
          )}
        </div>
      )}

      {/* Planned Events */}
      {canEdit && (
        <Card title="Planned Events" className="mt-6">
          <p className="text-muted mb-2 text-xs">
            One-time injections or withdrawals that modify the projection
            (bonus, inheritance, down payment).
            <HelpTip text="Unlike goals (which set a target and let the engine decide if it's funded), planned events directly add or remove dollars in a specific year." />
          </p>
          {brokerageLumpSums.length > 0 && (
            <div className="mb-3 space-y-1">
              {brokerageLumpSums.map((ls) => (
                <LumpSumBadge
                  key={ls.id}
                  event={ls}
                  onDelete={() =>
                    setBrokerageLumpSums((prev) =>
                      prev.filter((x) => x.id !== ls.id),
                    )
                  }
                />
              ))}
            </div>
          )}
          <LumpSumForm
            accounts={
              data.result.projectionByYear[0]?.individualAccountBalances
                .filter((ia) => isPortfolioParent(ia.parentCategory))
                .map((ia) => ({
                  name: ia.name,
                  category: ia.category,
                  taxType: ia.taxType,
                })) ?? []
            }
            onAdd={(ls) => setBrokerageLumpSums((prev) => [...prev, ls])}
            allowWithdrawals
            investedAtStartOf={(year) =>
              investedAtStartOf(data.result.projectionByYear, year)
            }
          />
        </Card>
      )}
    </>
  );
}

export type BrokerageFundingPanelProps = {
  activeProfileName: string | null;
  apiBalances: RouterOutputs["brokerage"]["computeSummary"]["apiBalances"];
  brokerageRamp: number;
  budgetLinks: RouterOutputs["brokerage"]["computeSummary"]["budgetLinks"];
  canEdit: boolean;
  canEditCostBasis: boolean;
  hasContextOverrides: boolean;
  portfolioAccounts: RouterOutputs["contribution"]["computeSummary"]["jointAccountTypes"];
  portfolioBrokerageAccounts: RouterOutputs["performance"]["performanceAccounts"]["list"];
  totalDirectContribution: number;
  totalOverflow: number;
  updateCostBasis: ReturnType<
    typeof trpc.performance.updateCostBasis.useMutation
  >;
  upsertSetting: ReturnType<
    typeof trpc.settings.appSettings.upsert.useMutation
  >;
};

/** The projection basis note, cost basis, funding sources and by-account summary. */
export function BrokerageFundingPanel({
  activeProfileName,
  apiBalances,
  brokerageRamp,
  budgetLinks,
  canEdit,
  canEditCostBasis,
  hasContextOverrides,
  portfolioAccounts,
  portfolioBrokerageAccounts,
  totalDirectContribution,
  totalOverflow,
  updateCostBasis,
  upsertSetting,
}: BrokerageFundingPanelProps) {
  return (
    <>
      {hasContextOverrides && (
        <div className="border-subtle bg-surface-secondary text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-xs">
          <span className="text-secondary font-medium">Projection basis:</span>
          <span>
            Contribution profile:{" "}
            <span className="text-primary font-medium">
              {activeProfileName}
            </span>
          </span>
          <HelpTip text="These settings are applied to both the funding summary and the year-by-year projection. Change them on the Paycheck page." />
        </div>
      )}

      {portfolioBrokerageAccounts.length > 0 && (
        <Card title="Cost Basis" className="mt-4">
          <CostBasisEditor
            accounts={portfolioBrokerageAccounts}
            canEdit={canEditCostBasis}
            onSave={(performanceAccountId, costBasis) =>
              updateCostBasis.mutate({ performanceAccountId, costBasis })
            }
          />
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Funding Sources */}
        <Card title="Funding Sources" className="lg:col-span-1">
          <FundingSources
            directContribution={totalDirectContribution}
            overflow={totalOverflow}
            ramp={brokerageRamp}
            canEdit={canEdit}
            onRampChange={(value) =>
              upsertSetting.mutate({
                key: "brokerage_contribution_increase",
                value: String(value),
              })
            }
          />
        </Card>

        {/* By Account */}
        <Card title="By Account" className="lg:col-span-2">
          <ByAccountSummary
            accounts={portfolioAccounts}
            apiBalances={apiBalances}
            budgetLinks={budgetLinks}
          />
        </Card>
      </div>
    </>
  );
}
