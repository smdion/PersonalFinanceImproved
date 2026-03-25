"use client";

/** Displays the post-sync preview panel for a budget API integration, showing cash, accounts, category mappings, budget/savings matches, portfolio links, and profile configuration. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { PreviewData, Service, BudgetMatch } from "./integrations-types";
import { StatusBadge } from "./integrations-status-badge";
import { ApiCategorySelect } from "./integrations-api-category-select";

export function PreviewPanel({
  preview,
  isActive,
  service,
}: {
  preview: PreviewData;
  isActive: boolean;
  service: Service;
}) {
  const utils = trpc.useUtils();
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
  const [expandedBudget, setExpandedBudget] = useState(false);
  const expandedSavings = true; // savings section uses <details> for collapse

  // Manual match overrides: budgetItemId -> selected apiCategoryId
  const [budgetOverrides, setBudgetOverrides] = useState<
    Record<number, string>
  >({});
  const [savingsOverrides, setSavingsOverrides] = useState<
    Record<number, string>
  >({});
  // For linking unmatched API cats to existing Ledgr items: apiCategoryId -> budgetItemId
  const [apiToExisting, setApiToExisting] = useState<Record<string, string>>(
    {},
  );
  // Portfolio mapping state
  const [newPortfolioLocal, setNewPortfolioLocal] = useState("");
  const [newPortfolioRemote, setNewPortfolioRemote] = useState("");
  const [newPortfolioDirection, setNewPortfolioDirection] = useState<
    "push" | "pull" | "both"
  >("push");

  const invalidatePreview = () => {
    utils.sync.getPreview.invalidate();
  };

  // Mutations for linking / unlinking
  const linkBudgetMut = trpc.budget.linkToApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const unlinkBudgetMut = trpc.budget.unlinkFromApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const linkSavingsMut = trpc.savings.linkGoalToApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const unlinkSavingsMut = trpc.savings.unlinkGoalFromApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const createItemMut = trpc.budget.createItem.useMutation({
    onSuccess: invalidatePreview,
  });
  const skipCategoryMut = trpc.sync.skipCategory.useMutation({
    onSuccess: invalidatePreview,
  });
  const unskipCategoryMut = trpc.sync.unskipCategory.useMutation({
    onSuccess: invalidatePreview,
  });
  const renameBudgetToApiMut = trpc.sync.renameBudgetItemToApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const renameBudgetApiNameMut = trpc.sync.renameBudgetItemApiName.useMutation({
    onSuccess: invalidatePreview,
  });
  const renameSavingsToApiMut = trpc.sync.renameSavingsGoalToApi.useMutation({
    onSuccess: invalidatePreview,
  });
  const renameSavingsApiNameMut =
    trpc.sync.renameSavingsGoalApiName.useMutation({
      onSuccess: invalidatePreview,
    });
  const syncAllNamesMut = trpc.sync.syncAllNames.useMutation({
    onSuccess: invalidatePreview,
  });
  const setLinkedProfileMut = trpc.sync.setLinkedProfile.useMutation({
    onSuccess: invalidatePreview,
  });
  const setLinkedColumnMut = trpc.sync.setLinkedColumn.useMutation({
    onSuccess: invalidatePreview,
  });
  const moveBudgetToApiGroupMut =
    trpc.sync.moveBudgetItemToApiGroup.useMutation({
      onSuccess: invalidatePreview,
    });
  const setBudgetSyncDirMut = trpc.budget.setSyncDirection.useMutation({
    onSuccess: invalidatePreview,
  });
  const linkReimbursementMut =
    trpc.savings.linkReimbursementCategory.useMutation({
      onSuccess: invalidatePreview,
    });
  const linkContribMut = trpc.budget.linkContributionAccount.useMutation({
    onSuccess: invalidatePreview,
  });
  const unlinkContribMut = trpc.budget.unlinkContributionAccount.useMutation({
    onSuccess: invalidatePreview,
  });

  // Contribution accounts for the contribution linking dropdown
  const contribAccountsQuery =
    trpc.budget.listContribAccountsForLinking.useQuery();
  const contribAccounts = contribAccountsQuery.data ?? [];

  const allApiCats = apiCategories ?? [];

  // Apply a single budget match
  const applyBudgetLink = (itemId: number, apiId: string) => {
    const cat = allApiCats.find((c) => c.id === apiId);
    if (!cat) return;
    linkBudgetMut.mutate({
      budgetItemId: itemId,
      apiCategoryId: apiId,
      apiCategoryName: cat.name,
      syncDirection: "pull",
    });
  };

  // Apply all suggested budget matches + any manual overrides
  const applyAllBudgetMatches = () => {
    if (!budget) return;
    const toLink = [
      ...budget.matches
        .filter((m) => m.status === "suggested" && m.apiCategoryId)
        .map((m) => ({ itemId: m.budgetItemId, apiId: m.apiCategoryId! })),
      ...Object.entries(budgetOverrides)
        .filter(([, v]) => v)
        .map(([k, v]) => ({ itemId: Number(k), apiId: v })),
    ];
    for (const { itemId, apiId } of toLink) {
      applyBudgetLink(itemId, apiId);
    }
  };

  // Apply a single savings match
  const applySavingsLink = (goalId: number, apiId: string) => {
    const cat = allApiCats.find((c) => c.id === apiId);
    if (!cat) return;
    linkSavingsMut.mutate({
      goalId,
      apiCategoryId: apiId,
      apiCategoryName: cat.name,
    });
  };

  const applyAllSavingsMatches = () => {
    if (!savings) return;
    const toLink = [
      ...savings.matches
        .filter((m) => m.status === "suggested" && m.apiCategoryId)
        .map((m) => ({ goalId: m.goalId, apiId: m.apiCategoryId! })),
      ...Object.entries(savingsOverrides)
        .filter(([, v]) => v)
        .map(([k, v]) => ({ goalId: Number(k), apiId: v })),
    ];
    for (const { goalId, apiId } of toLink) {
      applySavingsLink(goalId, apiId);
    }
  };

  const updateMappingsMut = trpc.sync.updateAccountMappings.useMutation({
    onSuccess: invalidatePreview,
  });
  const createAssetAndMapMut = trpc.sync.createAssetAndMap.useMutation({
    onSuccess: invalidatePreview,
  });

  // Create a Ledgr budget item from an unmatched API category
  const createFromApi = (apiCat: {
    id: string;
    name: string;
    groupName: string;
  }) => {
    createItemMut.mutate(
      { category: apiCat.groupName, subcategory: apiCat.name },
      {
        onSuccess: (created) => {
          if (created) {
            linkBudgetMut.mutate({
              budgetItemId: created.id,
              apiCategoryId: apiCat.id,
              apiCategoryName: apiCat.name,
              syncDirection: "pull",
            });
          }
        },
      },
    );
  };

  // Link an unmatched API category to an existing Ledgr budget item
  const linkApiToExisting = (
    apiCatId: string,
    apiCatName: string,
    budgetItemId: number,
  ) => {
    linkBudgetMut.mutate({
      budgetItemId,
      apiCategoryId: apiCatId,
      apiCategoryName: apiCatName,
      syncDirection: "pull",
    });
  };

  // Unlinked Ledgr items for the "link to existing" dropdown
  const unlinkedLedgrItems = budget
    ? budget.matches
        .filter((m) => m.status === "unmatched")
        .sort((a, b) =>
          `${a.ledgrCategory} ${a.ledgrName}`.localeCompare(
            `${b.ledgrCategory} ${b.ledgrName}`,
          ),
        )
    : [];

  // Group budget matches by ledgrCategory
  const budgetByCategory = budget
    ? Object.entries(
        budget.matches.reduce<Record<string, BudgetMatch[]>>((acc, m) => {
          (acc[m.ledgrCategory] ??= []).push(m);
          return acc;
        }, {}),
      ).sort(([a], [b]) => a.localeCompare(b))
    : [];

  // Count actionable items
  const suggestedCount =
    (budget?.summary.suggested ?? 0) + (savings?.summary.suggested ?? 0);
  const overrideCount =
    Object.values(budgetOverrides).filter(Boolean).length +
    Object.values(savingsOverrides).filter(Boolean).length;
  const totalActionable = suggestedCount + overrideCount;

  // Count drifted items (name or category)
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

      {/* Name drift banner */}
      {totalDrifted > 0 && (
        <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded p-2">
          <span className="text-amber-700">
            {totalDrifted} linked{" "}
            {totalDrifted === 1 ? "item has" : "items have"} different names or
            categories in Ledgr vs API
          </span>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() =>
                syncAllNamesMut.mutate({ service, direction: "pull" })
              }
              disabled={syncAllNamesMut.isPending}
              className="px-2 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded hover:bg-amber-200 whitespace-nowrap disabled:opacity-50"
            >
              Use all API names
            </button>
            <button
              onClick={() =>
                syncAllNamesMut.mutate({ service, direction: "keepLedgr" })
              }
              disabled={syncAllNamesMut.isPending}
              className="px-2 py-0.5 text-[10px] bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
            >
              Keep all Ledgr names
            </button>
          </div>
        </div>
      )}

      {/* Budget profile + column selector */}
      {profile && profile.availableProfiles.length > 0 && (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-muted whitespace-nowrap">Profile:</span>
          <select
            value={profile.linkedProfileId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val)
                setLinkedProfileMut.mutate({ service, profileId: Number(val) });
            }}
            className="px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary min-w-[120px]"
          >
            <option value="">Select...</option>
            {profile.availableProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
          {profile.columnLabels.length > 1 && (
            <>
              <span className="text-muted whitespace-nowrap">Mode:</span>
              <select
                value={profile.linkedColumnIndex}
                onChange={(e) =>
                  setLinkedColumnMut.mutate({
                    service,
                    columnIndex: Number(e.target.value),
                  })
                }
                className="px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary min-w-[80px]"
              >
                {profile.columnLabels.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

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

      {/* Budget category matching — grouped by Ledgr category */}
      {budget && budget.matches.length > 0 && (
        <details className="border border-subtle rounded-lg group/budget">
          <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Budget Category Matching
            </span>
            <span className="flex gap-2 text-[10px]">
              <span className="text-green-400">{budget.summary.linked}</span>
              <span className="text-yellow-400">
                {budget.summary.suggested}
              </span>
              <span className="text-faint">{budget.summary.unmatched}</span>
              {budget.summary.apiOnly > 0 && (
                <span className="text-purple-400">
                  {budget.summary.apiOnly} API-only
                </span>
              )}
            </span>
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {/* Inline details toggle for individual items */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpandedBudget(!expandedBudget)}
                className="text-[10px] text-blue-500 hover:text-blue-700"
              >
                {expandedBudget ? "Hide items" : "Show items"}
              </button>
            </div>

            <div className="flex items-center gap-2 text-[9px] text-faint flex-wrap">
              <span>Sync:</span>
              <span className="text-blue-500">→ pull</span>
              <span className="text-green-500">← push</span>
              <span className="text-purple-500">⇄ both</span>
              <span className="text-faint">|</span>
              <span>Set all:</span>
              {(["pull", "push", "both"] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => {
                    const linked = budget.matches.filter(
                      (m) => m.status === "linked" && m.syncDirection !== dir,
                    );
                    for (const m of linked) {
                      setBudgetSyncDirMut.mutate({
                        budgetItemId: m.budgetItemId,
                        syncDirection: dir,
                      });
                    }
                  }}
                  disabled={setBudgetSyncDirMut.isPending}
                  className={`px-1 py-0.5 rounded disabled:opacity-50 ${
                    dir === "push"
                      ? "text-green-500 hover:bg-green-50"
                      : dir === "both"
                        ? "text-purple-500 hover:bg-purple-50"
                        : "text-blue-500 hover:bg-blue-50"
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>

            {/* Apply all button */}
            {totalActionable > 0 && (
              <button
                onClick={applyAllBudgetMatches}
                disabled={linkBudgetMut.isPending}
                className="w-full px-2 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {linkBudgetMut.isPending
                  ? "Linking..."
                  : `Apply all suggested matches (${suggestedCount + overrideCount})`}
              </button>
            )}

            {/* Grouped by category */}
            {expandedBudget && (
              <div className="space-y-2">
                {budgetByCategory.map(([category, items]) => (
                  <div key={category}>
                    <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-0.5">
                      {category}
                    </p>
                    <div className="space-y-0.5 pl-1">
                      {items.map((m) => (
                        <div
                          key={m.budgetItemId}
                          className="flex items-center gap-1 text-xs min-h-[24px]"
                        >
                          <StatusBadge status={m.status} />
                          <span
                            className="text-secondary truncate min-w-[80px] max-w-[120px]"
                            title={m.ledgrName}
                          >
                            {m.ledgrName}
                          </span>
                          <span className="text-faint">&rarr;</span>

                          {m.status === "linked" && (
                            <>
                              <span
                                className="text-muted truncate flex-1"
                                title={`${m.apiGroupName} > ${m.apiCategoryName}`}
                              >
                                {m.apiCategoryName}
                              </span>
                              <button
                                onClick={() => {
                                  const next =
                                    m.syncDirection === "pull"
                                      ? "push"
                                      : m.syncDirection === "push"
                                        ? "both"
                                        : "pull";
                                  setBudgetSyncDirMut.mutate({
                                    budgetItemId: m.budgetItemId,
                                    syncDirection: next,
                                  });
                                }}
                                disabled={setBudgetSyncDirMut.isPending}
                                className={`text-[9px] px-1 py-0.5 rounded whitespace-nowrap disabled:opacity-50 ${
                                  m.syncDirection === "push"
                                    ? "bg-green-50 text-green-600 hover:bg-green-100"
                                    : m.syncDirection === "both"
                                      ? "bg-purple-50 text-purple-600 hover:bg-purple-100"
                                      : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                }`}
                                title={`Sync: ${m.syncDirection ?? "pull"} (click to change)`}
                              >
                                {m.syncDirection === "push"
                                  ? "← push"
                                  : m.syncDirection === "both"
                                    ? "⇄ both"
                                    : "→ pull"}
                              </button>
                              {(m.nameDrifted || m.categoryDrifted) && (
                                <span className="flex gap-0.5">
                                  {m.nameDrifted && (
                                    <button
                                      onClick={() =>
                                        renameBudgetToApiMut.mutate({
                                          budgetItemId: m.budgetItemId,
                                        })
                                      }
                                      disabled={renameBudgetToApiMut.isPending}
                                      className="text-[10px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 whitespace-nowrap disabled:opacity-50"
                                      title={`Rename "${m.ledgrName}" → "${m.apiCategoryName}"`}
                                    >
                                      Name
                                    </button>
                                  )}
                                  {m.categoryDrifted && m.apiGroupName && (
                                    <button
                                      onClick={() =>
                                        moveBudgetToApiGroupMut.mutate({
                                          budgetItemId: m.budgetItemId,
                                          apiGroupName: m.apiGroupName!,
                                        })
                                      }
                                      disabled={
                                        moveBudgetToApiGroupMut.isPending
                                      }
                                      className="text-[10px] px-1 py-0.5 bg-purple-50 text-purple-600 rounded hover:bg-purple-100 whitespace-nowrap disabled:opacity-50"
                                      title={`Move from "${m.ledgrCategory}" → "${m.apiGroupName}"`}
                                    >
                                      Group
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (m.nameDrifted)
                                        renameBudgetApiNameMut.mutate({
                                          budgetItemId: m.budgetItemId,
                                        });
                                    }}
                                    disabled={renameBudgetApiNameMut.isPending}
                                    className="text-[10px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
                                    title="Keep Ledgr names"
                                  >
                                    Keep
                                  </button>
                                </span>
                              )}
                              <button
                                onClick={() =>
                                  unlinkBudgetMut.mutate({
                                    budgetItemId: m.budgetItemId,
                                  })
                                }
                                disabled={unlinkBudgetMut.isPending}
                                className="text-red-400 hover:text-red-600 text-[10px] whitespace-nowrap"
                                title="Unlink"
                              >
                                &times;
                              </button>
                            </>
                          )}

                          {m.status === "suggested" && (
                            <>
                              <span
                                className="text-yellow-700 truncate flex-1"
                                title={`${m.apiGroupName} > ${m.apiCategoryName}`}
                              >
                                {m.apiCategoryName}
                              </span>
                              {expandedBudget && (
                                <button
                                  onClick={() =>
                                    applyBudgetLink(
                                      m.budgetItemId,
                                      m.apiCategoryId!,
                                    )
                                  }
                                  disabled={linkBudgetMut.isPending}
                                  className="text-[10px] text-blue-500 hover:text-blue-700 whitespace-nowrap"
                                >
                                  Link
                                </button>
                              )}
                            </>
                          )}

                          {m.status === "unmatched" && expandedBudget && (
                            <div className="flex-1">
                              <ApiCategorySelect
                                value={budgetOverrides[m.budgetItemId] ?? ""}
                                options={allApiCats}
                                onChange={(v) =>
                                  setBudgetOverrides((prev) => ({
                                    ...prev,
                                    [m.budgetItemId]: v,
                                  }))
                                }
                              />
                            </div>
                          )}

                          {m.status === "unmatched" && !expandedBudget && (
                            <span className="text-faint text-[10px] italic flex-1">
                              unmapped
                            </span>
                          )}

                          {m.apiBudgeted != null && (
                            <span className="text-faint tabular-nums whitespace-nowrap text-[10px]">
                              {formatCurrency(m.apiBudgeted)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Unmatched API categories — create new or link to existing Ledgr items */}
            {budget.unmatchedApiCategories.length > 0 && (
              <div className="border-t border-subtle pt-2 space-y-1">
                <p className="text-[10px] font-medium text-muted">
                  API categories not in Ledgr (
                  {budget.unmatchedApiCategories.length})
                </p>
                <p className="text-[10px] text-faint">
                  Link to an existing Ledgr item, create a new one, or ignore.
                </p>
                <div className="space-y-1">
                  {budget.unmatchedApiCategories.map((c) => (
                    <div key={c.id} className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 whitespace-nowrap">
                          API only
                        </span>
                        <span
                          className="text-muted truncate flex-1"
                          title={`${c.groupName} > ${c.name}`}
                        >
                          {c.groupName} &rsaquo; {c.name}
                        </span>
                        {c.budgeted !== 0 && (
                          <span className="text-faint tabular-nums text-[10px] whitespace-nowrap">
                            {formatCurrency(c.budgeted)}
                          </span>
                        )}
                        <button
                          onClick={() => createFromApi(c)}
                          disabled={createItemMut.isPending}
                          className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
                        >
                          + Create
                        </button>
                        <button
                          onClick={() =>
                            skipCategoryMut.mutate({
                              service,
                              categoryId: c.id,
                            })
                          }
                          disabled={skipCategoryMut.isPending}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-sunken text-muted rounded hover:bg-surface-elevated whitespace-nowrap disabled:opacity-50"
                        >
                          Skip
                        </button>
                      </div>
                      {/* Link to existing budget item or savings goal */}
                      {(unlinkedLedgrItems.length > 0 ||
                        (savings &&
                          savings.matches.some(
                            (m) => m.status === "unmatched",
                          ))) && (
                        <div className="flex items-center gap-1 pl-14">
                          <select
                            value={apiToExisting[c.id] ?? ""}
                            onChange={(e) =>
                              setApiToExisting((prev) => ({
                                ...prev,
                                [c.id]: e.target.value,
                              }))
                            }
                            className="flex-1 px-1 py-0.5 text-[10px] border rounded bg-surface-primary"
                          >
                            <option value="">Link to existing...</option>
                            {unlinkedLedgrItems.length > 0 && (
                              <optgroup label="Budget Items">
                                {unlinkedLedgrItems.map((item) => (
                                  <option
                                    key={`b:${item.budgetItemId}`}
                                    value={`budget:${item.budgetItemId}`}
                                  >
                                    {item.ledgrCategory} &rsaquo;{" "}
                                    {item.ledgrName}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {savings &&
                              savings.matches.filter(
                                (m) => m.status === "unmatched",
                              ).length > 0 && (
                                <optgroup label="Sinking Funds">
                                  {savings.matches
                                    .filter((m) => m.status === "unmatched")
                                    .map((m) => (
                                      <option
                                        key={`s:${m.goalId}`}
                                        value={`savings:${m.goalId}`}
                                      >
                                        {m.goalName}
                                      </option>
                                    ))}
                                </optgroup>
                              )}
                          </select>
                          {apiToExisting[c.id] && (
                            <button
                              onClick={() => {
                                const val = apiToExisting[c.id]!;
                                if (val.startsWith("budget:")) {
                                  linkApiToExisting(
                                    c.id,
                                    c.name,
                                    Number(val.slice(7)),
                                  );
                                } else if (val.startsWith("savings:")) {
                                  applySavingsLink(Number(val.slice(8)), c.id);
                                }
                              }}
                              disabled={
                                linkBudgetMut.isPending ||
                                linkSavingsMut.isPending
                              }
                              className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded hover:bg-green-100 whitespace-nowrap disabled:opacity-50"
                            >
                              Link
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skipped API categories */}
            {budget.skippedApiCategories &&
              budget.skippedApiCategories.length > 0 && (
                <div className="border-t border-subtle pt-2">
                  <details className="group">
                    <summary className="text-[10px] font-medium text-faint cursor-pointer hover:text-secondary">
                      Skipped ({budget.skippedApiCategories.length})
                    </summary>
                    <div className="mt-1 space-y-1">
                      {budget.skippedApiCategories.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-sunken text-faint whitespace-nowrap">
                            Skipped
                          </span>
                          <span
                            className="text-faint truncate flex-1"
                            title={`${c.groupName} > ${c.name}`}
                          >
                            {c.groupName} &rsaquo; {c.name}
                          </span>
                          <button
                            onClick={() =>
                              unskipCategoryMut.mutate({
                                service,
                                categoryId: c.id,
                              })
                            }
                            disabled={unskipCategoryMut.isPending}
                            className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 whitespace-nowrap disabled:opacity-50"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
          </div>
        </details>
      )}

      {/* Savings / sinking fund matching */}
      {savings && savings.matches.length > 0 && (
        <details className="border border-subtle rounded-lg">
          <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Sinking Fund Matching
            </span>
            <span className="flex gap-2 text-[10px]">
              <span className="text-green-400">{savings.summary.linked}</span>
              <span className="text-yellow-400">
                {savings.summary.suggested}
              </span>
              <span className="text-faint">{savings.summary.unmatched}</span>
            </span>
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {(savings.summary.suggested > 0 ||
              Object.values(savingsOverrides).some(Boolean)) && (
              <button
                onClick={applyAllSavingsMatches}
                disabled={linkSavingsMut.isPending}
                className="w-full px-2 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {linkSavingsMut.isPending
                  ? "Linking..."
                  : "Apply all suggested matches"}
              </button>
            )}

            <div className="space-y-0.5">
              {savings.matches.map((m) => (
                <React.Fragment key={m.goalId}>
                  <div className="flex items-center gap-1.5 text-xs min-h-[24px]">
                    <StatusBadge status={m.status} />
                    <span className="text-secondary truncate min-w-[80px] max-w-[120px]">
                      {m.goalName}
                    </span>
                    <span className="text-faint">&rarr;</span>

                    {m.status === "linked" && (
                      <>
                        <span className="text-muted truncate flex-1">
                          {m.apiCategoryName}
                        </span>
                        <span
                          className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-600"
                          title="Balance pulled from API, monthly contribution pushed to API"
                        >
                          ⇄ pull balance / push contribution
                        </span>
                        {m.nameDrifted && (
                          <>
                            <button
                              onClick={() =>
                                renameSavingsToApiMut.mutate({
                                  goalId: m.goalId,
                                })
                              }
                              disabled={renameSavingsToApiMut.isPending}
                              className="text-[10px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 whitespace-nowrap disabled:opacity-50"
                              title={`Rename Ledgr "${m.goalName}" to "${m.apiCategoryName}"`}
                            >
                              Use API
                            </button>
                            <button
                              onClick={() =>
                                renameSavingsApiNameMut.mutate({
                                  goalId: m.goalId,
                                })
                              }
                              disabled={renameSavingsApiNameMut.isPending}
                              className="text-[10px] px-1 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
                              title={`Keep Ledgr name "${m.goalName}"`}
                            >
                              Keep
                            </button>
                          </>
                        )}
                        <button
                          onClick={() =>
                            unlinkSavingsMut.mutate({ goalId: m.goalId })
                          }
                          disabled={unlinkSavingsMut.isPending}
                          className="text-red-400 hover:text-red-600 text-[10px] whitespace-nowrap"
                          title="Unlink"
                        >
                          &times;
                        </button>
                      </>
                    )}

                    {m.status === "suggested" && (
                      <>
                        <span className="text-yellow-700 truncate flex-1">
                          {m.apiCategoryName}
                        </span>
                        {expandedSavings && (
                          <button
                            onClick={() =>
                              applySavingsLink(m.goalId, m.apiCategoryId!)
                            }
                            disabled={linkSavingsMut.isPending}
                            className="text-[10px] text-blue-500 hover:text-blue-700 whitespace-nowrap"
                          >
                            Link
                          </button>
                        )}
                      </>
                    )}

                    {m.status === "unmatched" && expandedSavings && (
                      <div className="flex-1">
                        <ApiCategorySelect
                          value={savingsOverrides[m.goalId] ?? ""}
                          options={allApiCats}
                          onChange={(v) =>
                            setSavingsOverrides((prev) => ({
                              ...prev,
                              [m.goalId]: v,
                            }))
                          }
                        />
                      </div>
                    )}

                    {m.status === "unmatched" && !expandedSavings && (
                      <span className="text-faint text-[10px] italic flex-1">
                        unmapped
                      </span>
                    )}

                    {m.apiBalance != null && (
                      <span className="text-faint tabular-nums whitespace-nowrap text-[10px]">
                        {formatCurrency(m.apiBalance)}
                      </span>
                    )}
                  </div>
                  {/* Reimbursement category link for e-fund goal */}
                  {m.isEmergencyFund && m.status === "linked" && (
                    <div className="flex items-center gap-1.5 text-xs ml-4 min-h-[24px]">
                      <span className="text-faint text-[10px]">
                        ↳ Reimbursement category:
                      </span>
                      <div className="flex-1 max-w-[200px]">
                        <ApiCategorySelect
                          value={m.reimbursementApiCategoryId ?? ""}
                          options={allApiCats}
                          onChange={(v) =>
                            linkReimbursementMut.mutate({
                              goalId: m.goalId,
                              apiCategoryId: v || null,
                            })
                          }
                        />
                      </div>
                      {m.reimbursementApiCategoryId && (
                        <button
                          onClick={() =>
                            linkReimbursementMut.mutate({
                              goalId: m.goalId,
                              apiCategoryId: null,
                            })
                          }
                          disabled={linkReimbursementMut.isPending}
                          className="text-red-400 hover:text-red-600 text-[10px]"
                          title="Unlink reimbursement category"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* Non-payroll contribution account linking */}
      {budget &&
        contribAccounts.length > 0 &&
        (() => {
          const linkedItems = budget.matches.filter(
            (m) => m.contributionAccountId != null,
          );
          const usedContribIds = new Set(
            linkedItems.map((m) => m.contributionAccountId),
          );
          const unlinkedContribs = contribAccounts.filter(
            (ca) => !usedContribIds.has(ca.id),
          );
          const unlinkedBudgetItems = budget.matches.filter(
            (m) => m.contributionAccountId == null && m.status !== "linked",
          );

          if (linkedItems.length === 0 && unlinkedContribs.length === 0)
            return null;

          return (
            <details className="border border-subtle rounded-lg">
              <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  Contribution Account Linking
                </span>
                <span className="text-[10px] text-faint">
                  {linkedItems.length} linked · {unlinkedContribs.length}{" "}
                  unlinked
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-2">
                {/* Already linked items */}
                {linkedItems.length > 0 && (
                  <div className="space-y-0.5">
                    {linkedItems.map((m) => {
                      const ca = contribAccounts.find(
                        (c) => c.id === m.contributionAccountId,
                      );
                      return (
                        <div
                          key={m.budgetItemId}
                          className="flex items-center gap-1.5 text-xs min-h-[24px]"
                        >
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 whitespace-nowrap">
                            Linked
                          </span>
                          <span
                            className="text-secondary truncate min-w-[80px] max-w-[140px]"
                            title={`${m.ledgrCategory} > ${m.ledgrName}`}
                          >
                            {m.ledgrName}
                          </span>
                          <span className="text-faint">&rarr;</span>
                          <span className="text-green-700 truncate flex-1">
                            {ca?.displayLabel ??
                              `Account #${m.contributionAccountId}`}
                          </span>
                          <button
                            onClick={() =>
                              unlinkContribMut.mutate({
                                budgetItemId: m.budgetItemId,
                              })
                            }
                            disabled={unlinkContribMut.isPending}
                            className="text-red-400 hover:text-red-600 text-[10px] whitespace-nowrap"
                            title="Unlink contribution account"
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Unlinked contribution accounts — pick a budget item to link */}
                {unlinkedContribs.length > 0 && (
                  <div className="space-y-0.5 border-t border-subtle pt-2">
                    <p className="text-[10px] text-faint mb-1">
                      {unlinkedContribs.length} unlinked contribution{" "}
                      {unlinkedContribs.length === 1 ? "account" : "accounts"}
                    </p>
                    {unlinkedContribs.map((ca) => (
                      <div
                        key={ca.id}
                        className="flex items-center gap-1.5 text-xs min-h-[24px]"
                      >
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-faint whitespace-nowrap">
                          Unlinked
                        </span>
                        <span className="text-secondary truncate min-w-[80px] max-w-[140px]">
                          {ca.displayLabel}
                        </span>
                        <span className="text-faint">&rarr;</span>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              linkContribMut.mutate({
                                budgetItemId: Number(e.target.value),
                                contributionAccountId: ca.id,
                              });
                            }
                          }}
                          className="flex-1 px-1 py-0.5 text-[11px] border border-strong rounded bg-surface-primary"
                        >
                          <option value="">Select budget item...</option>
                          {unlinkedBudgetItems.map((m) => (
                            <option key={m.budgetItemId} value={m.budgetItemId}>
                              {m.ledgrCategory} &rsaquo; {m.ledgrName}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          );
        })()}

      {/* Portfolio → Tracking Account Mappings */}
      {portfolio && portfolio.trackingAccounts.length > 0 && (
        <details className="border border-subtle rounded-lg">
          <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Tracking Account Mappings
            </span>
            {(() => {
              const mappedRemoteIds = new Set(
                portfolio.existingMappings.map((m) => m.remoteAccountId),
              );
              const unmappedCount = portfolio.trackingAccounts.filter(
                (a) => !mappedRemoteIds.has(a.id),
              ).length;
              const totalTracking = portfolio.trackingAccounts.length;
              const mappedCount = totalTracking - unmappedCount;
              return unmappedCount === 0 ? (
                <span className="text-[10px] text-green-400">
                  {totalTracking}/{totalTracking} mapped
                </span>
              ) : (
                <span className="text-[10px] text-amber-400">
                  {mappedCount}/{totalTracking} mapped
                </span>
              );
            })()}
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {/* Existing mappings */}
            {portfolio.existingMappings.length > 0 && (
              <div className="space-y-0.5">
                {portfolio.existingMappings.map((m, i) => {
                  const tracking = portfolio.trackingAccounts.find(
                    (a) => a.id === m.remoteAccountId,
                  );
                  return (
                    <div
                      key={m.localId ?? m.localName}
                      className="flex items-center gap-1.5 text-xs bg-green-50 rounded px-2 py-1"
                    >
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 whitespace-nowrap">
                        Mapped
                      </span>
                      <span className="text-secondary truncate flex-1">
                        {(() => {
                          const lid = m.localId ?? m.localName;
                          const mm = lid.match(/^mortgage:(\d+):(\w+)$/);
                          if (mm) {
                            return (
                              portfolio.mortgageAccounts?.find(
                                (ma) =>
                                  ma.id === Number(mm[1]) && ma.type === mm[2],
                              )?.label ?? m.localName
                            );
                          }
                          return m.localName;
                        })()}
                      </span>
                      <span className="text-faint">&rarr;</span>
                      <span className="text-muted truncate flex-1">
                        {tracking?.name ??
                          m.remoteAccountId.slice(0, 12) + "..."}
                      </span>
                      <button
                        onClick={() => {
                          const next =
                            m.syncDirection === "pull"
                              ? "push"
                              : m.syncDirection === "push"
                                ? "both"
                                : "pull";
                          const updated = portfolio.existingMappings.map(
                            (em, j) =>
                              j === i
                                ? {
                                    ...em,
                                    syncDirection: next as
                                      | "pull"
                                      | "push"
                                      | "both",
                                  }
                                : em,
                          );
                          updateMappingsMut.mutate({
                            service,
                            mappings: updated,
                          });
                        }}
                        disabled={updateMappingsMut.isPending}
                        className={`text-[10px] px-1 py-0.5 rounded disabled:opacity-50 ${
                          m.syncDirection === "push"
                            ? "bg-green-100 text-green-600 hover:bg-green-200"
                            : m.syncDirection === "pull"
                              ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                              : "bg-purple-100 text-purple-600 hover:bg-purple-200"
                        }`}
                        title={`Sync: ${m.syncDirection} (click to change)`}
                      >
                        {m.syncDirection === "push"
                          ? "← push"
                          : m.syncDirection === "both"
                            ? "⇄ both"
                            : "→ pull"}
                      </button>
                      {tracking && (
                        <span className="text-faint tabular-nums text-[10px] whitespace-nowrap">
                          {formatCurrency(tracking.balance)}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          const updated = portfolio.existingMappings.filter(
                            (_, j) => j !== i,
                          );
                          updateMappingsMut.mutate({
                            service,
                            mappings: updated,
                          });
                        }}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Rollup summary: show which local accounts aggregate to each tracking account */}
            {portfolio.existingMappings.length > 1 &&
              (() => {
                const rollups = new Map<string, string[]>();
                for (const m of portfolio.existingMappings) {
                  const list = rollups.get(m.remoteAccountId) ?? [];
                  list.push(m.localName); // Display name for rollup
                  rollups.set(m.remoteAccountId, list);
                }
                const multiRollups = Array.from(rollups.entries()).filter(
                  ([, names]) => names.length > 1,
                );
                if (multiRollups.length === 0) return null;
                return (
                  <div className="text-[10px] text-faint space-y-0.5">
                    {multiRollups.map(([remoteId, names]) => {
                      const tracking = portfolio.trackingAccounts.find(
                        (a) => a.id === remoteId,
                      );
                      const localTotal = names.reduce((sum, n) => {
                        const acct = portfolio.localAccounts.find(
                          (a) => a.label === n,
                        );
                        return sum + (acct?.balance ?? 0);
                      }, 0);
                      return (
                        <div key={remoteId}>
                          {names.join(" + ")} = {formatCurrency(localTotal)}{" "}
                          &rarr; {tracking?.name ?? "Unknown"}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            {/* Unmapped tracking accounts */}
            {(() => {
              const mappedRemoteIds = new Set(
                portfolio.existingMappings.map((m) => m.remoteAccountId),
              );
              const unmappedTracking = portfolio.trackingAccounts.filter(
                (a) => !mappedRemoteIds.has(a.id),
              );
              if (unmappedTracking.length === 0) return null;

              // Build available local options with { localId, localName } pairs
              const allLocalOptions: { localId: string; localName: string }[] =
                [
                  ...portfolio.localAccounts
                    .filter((a) => a.performanceAccountId != null)
                    .map((a) => ({
                      localId: `performance:${a.performanceAccountId}`,
                      localName: a.label,
                    })),
                  ...(portfolio.assetAccounts ?? []).map((a) => ({
                    localId: `asset:${a.id}`,
                    localName: a.label,
                  })),
                  ...(portfolio.mortgageAccounts ?? []).map((m) => ({
                    localId: `mortgage:${m.id}:${m.type}`,
                    localName: m.label,
                  })),
                ];
              const mappedLocalKeys = new Set(
                portfolio.existingMappings.map(
                  (m) => `${m.localId ?? ""}|${m.localName}`,
                ),
              );
              const availableLocal = allLocalOptions.filter(
                (l) => !mappedLocalKeys.has(`${l.localId}|${l.localName}`),
              );

              return (
                <div className="border-t border-subtle pt-2 space-y-1">
                  <p className="text-[10px] font-medium text-muted">
                    Unmapped tracking accounts ({unmappedTracking.length})
                  </p>
                  <div className="space-y-1">
                    {unmappedTracking.map((t) => (
                      <div key={t.id} className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 whitespace-nowrap">
                            API only
                          </span>
                          <span className="text-muted truncate flex-1">
                            {t.name}
                          </span>
                          <span className="text-faint tabular-nums text-[10px] whitespace-nowrap">
                            {formatCurrency(t.balance)}
                          </span>
                          <button
                            onClick={() =>
                              createAssetAndMapMut.mutate({
                                service,
                                assetName: t.name,
                                balance: t.balance,
                                remoteAccountId: t.id,
                                syncDirection: "pull",
                              })
                            }
                            disabled={createAssetAndMapMut.isPending}
                            className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
                          >
                            + Create Asset
                          </button>
                        </div>
                        {availableLocal.length > 0 && (
                          <div className="flex items-center gap-1 pl-14">
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const opt = availableLocal.find(
                                  (o) => o.localId === e.target.value,
                                );
                                if (!opt) return;
                                const updated = [
                                  ...portfolio.existingMappings,
                                  {
                                    localId: opt.localId,
                                    localName: opt.localName,
                                    remoteAccountId: t.id,
                                    syncDirection: "pull" as const,
                                  },
                                ];
                                updateMappingsMut.mutate({
                                  service,
                                  mappings: updated,
                                });
                              }}
                              className="flex-1 px-1 py-0.5 text-[10px] border rounded bg-surface-primary"
                            >
                              <option value="">Link to existing...</option>
                              {availableLocal.map((l) => (
                                <option key={l.localId} value={l.localId}>
                                  {l.localName}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Add new mapping */}
            <div className="flex gap-1 items-end flex-wrap border-t border-subtle pt-2">
              <div className="flex-1 min-w-[100px]">
                <label className="block text-[10px] font-medium text-muted mb-0.5">
                  Ledgr Account
                </label>
                <select
                  value={newPortfolioLocal}
                  onChange={(e) => setNewPortfolioLocal(e.target.value)}
                  className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
                >
                  <option value="">Select...</option>
                  {(() => {
                    // Build set of mapped identities using "localId|localName" composite
                    // so two accounts sharing the same performanceAccountId (e.g. two IRAs
                    // at the same institution owned by different people) are distinguished.
                    const mappedKeys = new Set(
                      portfolio.existingMappings.map(
                        (m) => `${m.localId ?? ""}|${m.localName}`,
                      ),
                    );
                    const unmappedPortfolio = portfolio.localAccounts.filter(
                      (a) =>
                        a.performanceAccountId != null &&
                        !mappedKeys.has(
                          `performance:${a.performanceAccountId}|${a.label}`,
                        ),
                    );
                    const unmappedAssets = (
                      portfolio.assetAccounts ?? []
                    ).filter(
                      (a) => !mappedKeys.has(`asset:${a.id}|${a.label}`),
                    );
                    const unmappedMortgages = (
                      portfolio.mortgageAccounts ?? []
                    ).filter(
                      (m) =>
                        !mappedKeys.has(
                          `mortgage:${m.id}:${m.type}|${m.label}`,
                        ),
                    );
                    return (
                      <>
                        {unmappedPortfolio.length > 0 && (
                          <optgroup label="Portfolio Accounts">
                            {unmappedPortfolio.map((a) => (
                              <option
                                key={`p:${a.performanceAccountId}`}
                                value={`performance:${a.performanceAccountId}|${a.label}`}
                              >
                                {a.label} ({formatCurrency(a.balance)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {unmappedAssets.length > 0 && (
                          <optgroup label="Assets / Liabilities">
                            {unmappedAssets.map((a) => (
                              <option
                                key={`a:${a.id}`}
                                value={`asset:${a.id}|${a.label}`}
                              >
                                {a.label} ({formatCurrency(a.balance)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {unmappedMortgages.length > 0 && (
                          <optgroup label="Mortgage Properties">
                            {unmappedMortgages.map((m) => (
                              <option
                                key={`m:${m.id}:${m.type}`}
                                value={`mortgage:${m.id}:${m.type}|${m.label}`}
                              >
                                {m.label} ({formatCurrency(m.value)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    );
                  })()}
                </select>
              </div>
              <div className="flex-1 min-w-[100px]">
                <label className="block text-[10px] font-medium text-muted mb-0.5">
                  Tracking Account
                </label>
                <select
                  value={newPortfolioRemote}
                  onChange={(e) => setNewPortfolioRemote(e.target.value)}
                  className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
                >
                  <option value="">Select...</option>
                  {portfolio.trackingAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatCurrency(a.balance)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-16">
                <label className="block text-[10px] font-medium text-muted mb-0.5">
                  Dir
                </label>
                <select
                  value={newPortfolioDirection}
                  onChange={(e) =>
                    setNewPortfolioDirection(
                      e.target.value as "push" | "pull" | "both",
                    )
                  }
                  className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
                >
                  <option value="push">Push</option>
                  <option value="pull">Pull</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <button
                onClick={() => {
                  if (!newPortfolioLocal || !newPortfolioRemote) return;
                  // Value format: "localId|localName"
                  const pipeIdx = newPortfolioLocal.indexOf("|");
                  const localId =
                    pipeIdx >= 0
                      ? newPortfolioLocal.slice(0, pipeIdx)
                      : newPortfolioLocal;
                  const localName =
                    pipeIdx >= 0
                      ? newPortfolioLocal.slice(pipeIdx + 1)
                      : newPortfolioLocal;
                  const updated = [
                    ...portfolio.existingMappings,
                    {
                      localId,
                      localName,
                      remoteAccountId: newPortfolioRemote,
                      syncDirection: newPortfolioDirection,
                    },
                  ];
                  updateMappingsMut.mutate({ service, mappings: updated });
                  setNewPortfolioLocal("");
                  setNewPortfolioRemote("");
                }}
                disabled={
                  !newPortfolioLocal ||
                  !newPortfolioRemote ||
                  updateMappingsMut.isPending
                }
                className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
