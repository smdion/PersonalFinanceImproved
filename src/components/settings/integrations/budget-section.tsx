"use client";

/**
 * Budget-category-matching section of the integrations preview panel.
 *
 * Owns the local UI state for this section: the expanded/collapsed toggle,
 * manual budget overrides (budgetItemId -> apiCategoryId), and the
 * "link API cat to existing Ledgr item" select state.
 *
 * Cross-section coupling note: the "API categories not in Ledgr" block lets
 * the user link an unmatched API category to either a Ledgr budget item OR
 * a sinking-fund goal. Linking to a savings goal fires the savings
 * `linkGoalToApi` mutation, so we accept `onLinkSavings` as a callback prop
 * (implemented by the parent with `savingsMutations.linkSavings`). This
 * keeps the coupling explicit and typed rather than making the budget
 * section reach into `savingsMutations` directly.
 */
import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import type {
  ApiCategoryOption,
  BudgetMatch,
  PreviewData,
  Service,
} from "../integrations-types";
import { StatusBadge } from "../integrations-status-badge";
import { ApiCategorySelect } from "../integrations-api-category-select";
import type { BudgetIntegrationsMutations } from "./hooks/use-budget-mutations";

type Props = {
  service: Service;
  budget: NonNullable<PreviewData["budget"]>;
  savings: PreviewData["savings"];
  allApiCats: ApiCategoryOption[];
  mutations: BudgetIntegrationsMutations;
  onLinkSavings: (goalId: number, apiCategoryId: string) => void;
  /**
   * Number of savings-section overrides the user has queued up. The
   * "Apply all suggested matches" button counter displays
   *   budget.summary.suggested + savings.summary.suggested + budget overrides + savings overrides
   * to match the pre-split behavior exactly. The button itself still
   * applies only budget links (same as before the split).
   */
  savingsOverrideCount: number;
};

export function BudgetSection({
  service,
  budget,
  savings,
  allApiCats,
  mutations,
  onLinkSavings,
  savingsOverrideCount,
}: Props) {
  const {
    linkBudget: linkBudgetMut,
    unlinkBudget: unlinkBudgetMut,
    createItem: createItemMut,
    skipCategory: skipCategoryMut,
    unskipCategory: unskipCategoryMut,
    renameBudgetToApi: renameBudgetToApiMut,
    renameBudgetApiName: renameBudgetApiNameMut,
    moveBudgetToApiGroup: moveBudgetToApiGroupMut,
    setBudgetSyncDir: setBudgetSyncDirMut,
  } = mutations;

  const [expandedBudget, setExpandedBudget] = useState(false);
  const [budgetOverrides, setBudgetOverrides] = useState<
    Record<number, string>
  >({});
  // For linking unmatched API cats to existing Ledgr items: apiCategoryId -> "budget:123" or "savings:45"
  const [apiToExisting, setApiToExisting] = useState<Record<string, string>>(
    {},
  );

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

  // Create a Ledgr budget item from an unmatched API category, then link it
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
  const unlinkedLedgrItems = budget.matches
    .filter((m) => m.status === "unmatched")
    .sort((a, b) =>
      `${a.ledgrCategory} ${a.ledgrName}`.localeCompare(
        `${b.ledgrCategory} ${b.ledgrName}`,
      ),
    );

  // Group budget matches by ledgrCategory
  const budgetByCategory = Object.entries(
    budget.matches.reduce<Record<string, BudgetMatch[]>>((acc, m) => {
      (acc[m.ledgrCategory] ??= []).push(m);
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  const suggestedCount =
    budget.summary.suggested + (savings?.summary.suggested ?? 0);
  const overrideCount =
    Object.values(budgetOverrides).filter(Boolean).length +
    savingsOverrideCount;
  const totalActionable = suggestedCount + overrideCount;

  if (budget.matches.length === 0) return null;

  return (
    <details className="border border-subtle rounded-lg group/budget">
      <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Budget Category Matching
        </span>
        <span className="flex gap-2 text-[10px]">
          <span className="text-green-400">{budget.summary.linked}</span>
          <span className="text-yellow-400">{budget.summary.suggested}</span>
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
                                  disabled={moveBudgetToApiGroupMut.isPending}
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
                                {item.ledgrCategory} &rsaquo; {item.ledgrName}
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
                              onLinkSavings(Number(val.slice(8)), c.id);
                            }
                          }}
                          disabled={linkBudgetMut.isPending}
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
  );
}
