"use client";

/** Displays the post-sync preview panel for a budget API integration, showing cash, accounts, category mappings, budget/savings matches, portfolio links, and profile configuration. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { PreviewData, Service } from "./integrations-types";
import { useIntegrationSavingsMutations } from "./integrations/use-integration-savings-mutations";
import { DriftBanner } from "./integrations/drift-banner";
import { BudgetSection } from "./integrations/budget-section";
import { SavingsSection } from "./integrations/savings-section";
import { ContributionSection } from "./integrations/contrib-section";
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

  // Each section calls its own mutation hook, except savings: the budget
  // section links and creates goals through the same savings mutations, so
  // they live here and the savings section sees those links as pending.
  const savingsMutations = useIntegrationSavingsMutations();

  // `savingsOverrides` lives here (not inside SavingsSection) because
  // BudgetSection's "Apply all suggested matches" counter needs the count.
  // See savings-section.tsx header for the full rationale.
  const [savingsOverrides, setSavingsOverrides] = useState<
    Record<number, string>
  >({});
  const savingsOverrideCount =
    Object.values(savingsOverrides).filter(Boolean).length;

  // Contribution accounts for the contribution linking dropdown
  const contributionAccountsQuery =
    trpc.budget.listContributionAccountsForLinking.useQuery();
  const contributionAccounts = contributionAccountsQuery.data ?? [];

  const allApiCats = apiCategories;

  // BudgetSection can link an unmatched API category to a sinking-fund goal;
  // that path goes through this callback, not `savingsMutations` directly.
  const handleLinkSavingsFromBudget = (goalId: number, apiId: string) => {
    const cat = allApiCats.find((c) => c.id === apiId);
    if (!cat) return;
    savingsMutations.linkSavings.mutate({
      goalId,
      service,
      apiCategoryId: apiId,
      apiCategoryName: cat.name,
    });
  };

  const handleCreateSavingsGoalFromApi = async (apiCat: {
    id: string;
    name: string;
  }) => {
    try {
      const created = await savingsMutations.createGoal.mutateAsync({
        name: apiCat.name,
        targetMode: "ongoing",
        isActive: true,
      });
      await savingsMutations.linkSavings.mutateAsync({
        goalId: created.id,
        service,
        apiCategoryId: apiCat.id,
        apiCategoryName: apiCat.name,
      });
    } catch (err) {
      console.warn("Failed to create savings goal from API category:", err);
    }
  };

  // Count drifted items (name or category) — pure derived state, kept in
  // the orchestrator so both the dashboard header and the DriftBanner
  // component can read the same number.
  const driftedBudgetCount = budget.matches.filter(
    (m) => m.nameDrifted || m.categoryDrifted,
  ).length;
  const driftedSavingsCount = savings.matches.filter(
    (m) => m.nameDrifted,
  ).length;
  const totalDrifted = driftedBudgetCount + driftedSavingsCount;

  return (
    <div className="border-subtle space-y-4 border-t pt-4">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs font-medium tracking-wider uppercase">
          {isActive ? "Synced Data" : "Preview"}
        </span>
        {fetchedAt && (
          <span className="text-caption text-faint">
            Fetched {formatDate(fetchedAt.toString())}
          </span>
        )}
      </div>

      <DriftBanner
        service={service}
        profile={profile}
        totalDrifted={totalDrifted}
      />

      {/* Dashboard — compact overview row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="bg-surface-sunken rounded-lg p-3">
          <p className="text-caption text-muted font-medium tracking-wide uppercase">
            Cash
          </p>
          <div className="text-primary text-lg font-semibold">
            {formatCurrency(cash.api)}
          </div>
          {cashDiff !== 0 && (
            <p
              className={`text-caption ${cashDiff > 0 ? "text-green-400" : "text-red-400"}`}
            >
              {cashDiff > 0 ? "+" : ""}
              {formatCurrency(cashDiff)} vs manual
            </p>
          )}
          {cash.apiAccounts.length > 0 && (
            <details className="mt-1.5">
              <summary className="text-caption text-faint hover:text-secondary cursor-pointer select-none">
                {cash.apiAccounts.length} accounts
              </summary>
              <div className="mt-1 space-y-0.5">
                {cash.apiAccounts.map((a) => (
                  <div
                    key={a.name}
                    className="text-caption text-faint flex justify-between"
                  >
                    <span className="mr-1 truncate">{a.name}</span>
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
          <p className="text-caption text-muted font-medium tracking-wide uppercase">
            Accounts
          </p>
          <div className="text-primary text-lg font-semibold">
            {accounts.total}
          </div>
          <p className="text-caption text-faint">
            {accounts.onBudget} on budget · {accounts.tracking} tracking
          </p>
          {Object.keys(accounts.byType).length > 0 && (
            <details className="mt-1.5">
              <summary className="text-caption text-faint hover:text-secondary cursor-pointer select-none">
                By type
              </summary>
              <div className="mt-1 space-y-0.5">
                {Object.entries(accounts.byType)
                  .sort((a, b) => b[1].balance - a[1].balance)
                  .map(([type, info]) => (
                    <div
                      key={type}
                      className="text-caption text-faint flex justify-between"
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
          <p className="text-caption text-muted font-medium tracking-wide uppercase">
            Categories
          </p>
          <div className="text-primary text-lg font-semibold">
            {categories.total}
          </div>
          <p className="text-caption text-faint">{categories.groups} groups</p>
        </div>
      </div>

      <BudgetSection
        service={service}
        budget={budget}
        savings={savings}
        allApiCats={allApiCats}
        onLinkSavings={handleLinkSavingsFromBudget}
        onCreateSavingsGoalFromApi={handleCreateSavingsGoalFromApi}
        savingsOverrideCount={savingsOverrideCount}
      />

      <SavingsSection
        service={service}
        savings={savings}
        allApiCats={allApiCats}
        linkSavings={savingsMutations.linkSavings}
        unlinkSavings={savingsMutations.unlinkSavings}
        renameSavingsToApi={savingsMutations.renameSavingsToApi}
        renameSavingsApiName={savingsMutations.renameSavingsApiName}
        linkReimbursement={savingsMutations.linkReimbursement}
        savingsOverrides={savingsOverrides}
        setSavingsOverrides={setSavingsOverrides}
      />

      <ContributionSection
        budget={budget}
        contributionAccounts={contributionAccounts}
      />

      <PortfolioSection service={service} portfolio={portfolio} />
    </div>
  );
}
