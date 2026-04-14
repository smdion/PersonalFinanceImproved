"use client";

/** Displays the post-sync preview panel for a budget API integration, showing cash, accounts, category mappings, budget/savings matches, portfolio links, and profile configuration. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { PreviewData, Service } from "./integrations-types";
import { useDriftMutations } from "./integrations/hooks/use-drift-mutations";
import { useBudgetIntegrationsMutations } from "./integrations/hooks/use-budget-mutations";
import { useSavingsMutations } from "./integrations/hooks/use-savings-mutations";
import { useContribMutations } from "./integrations/hooks/use-contrib-mutations";
import { usePortfolioMutations } from "./integrations/hooks/use-portfolio-mutations";
import { DriftBanner } from "./integrations/drift-banner";
import { BudgetSection } from "./integrations/budget-section";
import { SavingsSection } from "./integrations/savings-section";
import { ContribSection } from "./integrations/contrib-section";
import { PortfolioSection } from "./integrations/portfolio-section";

export function PreviewPanel({
  preview,
  isActive,
  service,
}: {
  preview: PreviewData;
  isActive: boolean;
  service: Service;
}) {
  const {
    cash,
    accounts,
    categories,
    fetchedAt,
    budget,
    savings,
    apiCategories,
    portfolio,
    profile,
  } = preview;
  const cashDiff = cash.api - cash.manual;

  // Per-section mutation hooks — each hook owns a bundle for its section
  // only so a pending flip in one section does not re-render the other four
  // once PR 6 section components land with `React.memo`.
  const driftMutations = useDriftMutations();
  const budgetMutations = useBudgetIntegrationsMutations();
  const savingsMutations = useSavingsMutations();
  const contribMutations = useContribMutations();
  const portfolioMutations = usePortfolioMutations();

  // `savingsOverrides` lives here (not inside SavingsSection) because
  // BudgetSection's "Apply all suggested matches" counter needs the count.
  // See savings-section.tsx header for the full rationale.
  const [savingsOverrides, setSavingsOverrides] = useState<
    Record<number, string>
  >({});
  const savingsOverrideCount =
    Object.values(savingsOverrides).filter(Boolean).length;

  // Contribution accounts for the contribution linking dropdown
  const contribAccountsQuery =
    trpc.budget.listContribAccountsForLinking.useQuery();
  const contribAccounts = contribAccountsQuery.data ?? [];

  const allApiCats = apiCategories ?? [];

  // Cross-section linking helper: BudgetSection lets the user link an
  // unmatched API category to either a budget item or a sinking-fund goal.
  // The savings path goes through this callback so BudgetSection does not
  // need a direct handle to `savingsMutations`.
  const handleLinkSavingsFromBudget = (goalId: number, apiId: string) => {
    const cat = allApiCats.find((c) => c.id === apiId);
    if (!cat) return;
    savingsMutations.linkSavings.mutate({
      goalId,
      apiCategoryId: apiId,
      apiCategoryName: cat.name,
    });
  };

  // Count drifted items (name or category) — pure derived state, kept in
  // the orchestrator so both the dashboard header and the DriftBanner
  // component can read the same number.
  const driftedBudgetCount =
    budget?.matches.filter((m) => m.nameDrifted || m.categoryDrifted).length ??
    0;
  const driftedSavingsCount =
    savings?.matches.filter((m) => m.nameDrifted).length ?? 0;
  const totalDrifted = driftedBudgetCount + driftedSavingsCount;

  return (
    <div className="border-t border-subtle pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">
          {isActive ? "Synced Data" : "Preview"}
        </span>
        {fetchedAt && (
          <span className="text-[10px] text-faint">
            Fetched {formatDate(fetchedAt.toString())}
          </span>
        )}
      </div>

      <DriftBanner
        service={service}
        profile={profile}
        totalDrifted={totalDrifted}
        mutations={driftMutations}
      />

      {/* Dashboard — compact overview row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-sunken rounded-lg p-3">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Cash
          </p>
          <div className="text-lg font-semibold text-primary">
            {formatCurrency(cash.api)}
          </div>
          {cashDiff !== 0 && (
            <p
              className={`text-[10px] ${cashDiff > 0 ? "text-green-400" : "text-red-400"}`}
            >
              {cashDiff > 0 ? "+" : ""}
              {formatCurrency(cashDiff)} vs manual
            </p>
          )}
          {cash.apiAccounts.length > 0 && (
            <details className="mt-1.5">
              <summary className="text-[10px] text-faint cursor-pointer hover:text-secondary select-none">
                {cash.apiAccounts.length} accounts
              </summary>
              <div className="mt-1 space-y-0.5">
                {cash.apiAccounts.map((a) => (
                  <div
                    key={a.name}
                    className="flex justify-between text-[10px] text-faint"
                  >
                    <span className="truncate mr-1">{a.name}</span>
                    <span className="tabular-nums">
                      {formatCurrency(a.balance)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
        <div className="bg-surface-sunken rounded-lg p-3">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Accounts
          </p>
          <div className="text-lg font-semibold text-primary">
            {accounts.total}
          </div>
          <p className="text-[10px] text-faint">
            {accounts.onBudget} on budget · {accounts.tracking} tracking
          </p>
          {Object.keys(accounts.byType).length > 0 && (
            <details className="mt-1.5">
              <summary className="text-[10px] text-faint cursor-pointer hover:text-secondary select-none">
                By type
              </summary>
              <div className="mt-1 space-y-0.5">
                {Object.entries(accounts.byType)
                  .sort((a, b) => b[1].balance - a[1].balance)
                  .map(([type, info]) => (
                    <div
                      key={type}
                      className="flex justify-between text-[10px] text-faint"
                    >
                      <span>
                        {type} ({info.count})
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(info.balance)}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
        <div className="bg-surface-sunken rounded-lg p-3">
          <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
            Categories
          </p>
          <div className="text-lg font-semibold text-primary">
            {categories.total}
          </div>
          <p className="text-[10px] text-faint">{categories.groups} groups</p>
        </div>
      </div>

      {budget && (
        <BudgetSection
          service={service}
          budget={budget}
          savings={savings}
          allApiCats={allApiCats}
          mutations={budgetMutations}
          onLinkSavings={handleLinkSavingsFromBudget}
          savingsOverrideCount={savingsOverrideCount}
        />
      )}

      {savings && (
        <SavingsSection
          savings={savings}
          allApiCats={allApiCats}
          mutations={savingsMutations}
          savingsOverrides={savingsOverrides}
          setSavingsOverrides={setSavingsOverrides}
        />
      )}

      {budget && (
        <ContribSection
          budget={budget}
          contribAccounts={contribAccounts}
          mutations={contribMutations}
        />
      )}

      {portfolio && (
        <PortfolioSection
          service={service}
          portfolio={portfolio}
          mutations={portfolioMutations}
        />
      )}
    </div>
  );
}
