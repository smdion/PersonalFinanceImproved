"use client";

/**
 * Sinking-fund matching section of the integrations preview panel.
 *
 * Renders the collapsible savings block: linked / suggested / unmatched
 * goals plus the reimbursement-category picker for the emergency fund.
 *
 * State note: `savingsOverrides` lives in the parent orchestrator because
 * the budget section's "Apply all suggested matches" counter needs to know
 * how many savings overrides are queued. Passing the state up is cheaper
 * than duplicating it or drilling a callback both ways.
 */
import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import type { ApiCategoryOption, PreviewData } from "../integrations-types";
import { StatusBadge } from "../integrations-status-badge";
import { ApiCategorySelect } from "../integrations-api-category-select";
import type { SavingsMutations } from "./hooks/use-savings-mutations";

type Props = {
  savings: NonNullable<PreviewData["savings"]>;
  allApiCats: ApiCategoryOption[];
  mutations: SavingsMutations;
  savingsOverrides: Record<number, string>;
  setSavingsOverrides: React.Dispatch<
    React.SetStateAction<Record<number, string>>
  >;
};

export function SavingsSection({
  savings,
  allApiCats,
  mutations,
  savingsOverrides,
  setSavingsOverrides,
}: Props) {
  const {
    linkSavings: linkSavingsMut,
    unlinkSavings: unlinkSavingsMut,
    renameSavingsToApi: renameSavingsToApiMut,
    renameSavingsApiName: renameSavingsApiNameMut,
    linkReimbursement: linkReimbursementMut,
  } = mutations;

  // savings section uses <details> for collapse — matches pre-split behavior
  // where `expandedSavings` was hard-coded to true for the inner rendering.
  const expandedSavings = true;

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

  if (savings.matches.length === 0) return null;

  return (
    <details className="border border-subtle rounded-lg">
      <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Sinking Fund Matching
        </span>
        <span className="flex gap-2 text-[10px]">
          <span className="text-green-400">{savings.summary.linked}</span>
          <span className="text-yellow-400">{savings.summary.suggested}</span>
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
  );
}
