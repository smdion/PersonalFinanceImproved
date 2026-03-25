"use client";

import React, { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  PushPreviewModal,
  type PushPreviewItem,
} from "@/components/ui/push-preview-modal";

interface RawGoal {
  id: number;
  name: string;
  monthlyContribution: string | null;
  targetAmount: string | null;
  apiCategoryId?: string | null;
  isApiSyncEnabled?: boolean | null;
}

interface ApiCategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
}

export interface ApiSyncSectionProps {
  rawGoals: RawGoal[];
  apiBalanceMap: Map<
    number,
    { balance: number; budgeted: number; activity: number }
  >;
  apiBalancesData?: {
    service?: string | null;
    balances?: {
      goalId: number;
      balance: number;
      budgeted: number;
      activity: number;
    }[];
  } | null;
  apiCategoriesData?: { groups?: ApiCategoryGroup[] } | null;
  canEdit: boolean;
  linkingGoalId: number | null;
  setLinkingGoalId: (id: number | null) => void;
  pushPreviewItems: PushPreviewItem[] | null;
  setPushPreviewItems: (items: PushPreviewItem[] | null) => void;
  pendingPushGoalId: number | undefined;
  setPendingPushGoalId: (id: number | undefined) => void;
}

export function ApiSyncSection({
  rawGoals: _rawGoals,
  apiBalanceMap: _apiBalanceMap,
  apiBalancesData,
  apiCategoriesData,
  canEdit: _canEdit,
  linkingGoalId,
  setLinkingGoalId,
  pushPreviewItems,
  setPushPreviewItems,
  pendingPushGoalId,
  setPendingPushGoalId,
}: ApiSyncSectionProps) {
  const utils = trpc.useUtils();

  // ── Mutations ──
  const linkGoalToApi = trpc.savings.linkGoalToApi.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const pushToApi = trpc.savings.pushContributionsToApi.useMutation();

  return (
    <>
      {/* API Category Linking Modal */}
      {linkingGoalId !== null && apiCategoriesData?.groups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface-primary rounded-lg shadow-xl p-4 w-80 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-secondary">
                Link to API Category
              </h3>
              <button
                onClick={() => setLinkingGoalId(null)}
                className="text-faint hover:text-muted text-xs"
              >
                Close
              </button>
            </div>
            {apiCategoriesData.groups.length === 0 ? (
              <p className="text-xs text-faint text-center py-4">
                No categories. Sync budget API first.
              </p>
            ) : (
              apiCategoriesData.groups.map((group) => (
                <div key={group.id} className="mb-2">
                  <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1 py-0.5">
                    {group.name}
                  </div>
                  {group.categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        linkGoalToApi.mutate({
                          goalId: linkingGoalId,
                          apiCategoryId: cat.id,
                          apiCategoryName: `${group.name}: ${cat.name}`,
                        });
                        setLinkingGoalId(null);
                      }}
                      className="w-full text-left px-2 py-1 text-xs rounded hover:bg-blue-50 text-secondary"
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Push to API preview modal */}
      {pushPreviewItems && (
        <PushPreviewModal
          title={`Push contributions to ${apiBalancesData?.service?.toUpperCase() ?? "API"}`}
          items={pushPreviewItems}
          onConfirm={() => {
            pushToApi.mutate(
              pendingPushGoalId ? { goalId: pendingPushGoalId } : {},
              {
                onSettled: () => {
                  setPushPreviewItems(null);
                  setPendingPushGoalId(undefined);
                },
              },
            );
          }}
          onCancel={() => {
            setPushPreviewItems(null);
            setPendingPushGoalId(undefined);
          }}
          isPending={pushToApi.isPending}
        />
      )}
    </>
  );
}

/**
 * Hook providing API sync mutations and state for use in the page orchestrator.
 * Mutations that need to be called from other sections (link/unlink/convert/sync/push)
 * are returned as stable callbacks.
 */
export function useApiSync() {
  const utils = trpc.useUtils();

  const unlinkGoalFromApi = trpc.savings.unlinkGoalFromApi.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const convertToBudgetItem = trpc.savings.convertGoalToBudgetItem.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      utils.budget.invalidate();
    },
  });
  const pushToApi = trpc.savings.pushContributionsToApi.useMutation();
  const deleteOverride = trpc.savings.allocationOverrides.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });

  const [linkingGoalId, setLinkingGoalId] = useState<number | null>(null);
  const [pushPreviewItems, setPushPreviewItems] = useState<
    PushPreviewItem[] | null
  >(null);
  const [pendingPushGoalId, setPendingPushGoalId] = useState<
    number | undefined
  >(undefined);

  const onLinkToApi = useCallback(
    (goalId: number) => setLinkingGoalId(goalId),
    [],
  );
  const onUnlinkFromApi = useCallback(
    (goalId: number) => unlinkGoalFromApi.mutate({ goalId }),
    [unlinkGoalFromApi],
  );
  const onConvertToBudgetItem = useCallback(
    (goalId: number, name: string) =>
      convertToBudgetItem.mutate({
        goalId,
        category: "Savings",
        subcategory: name,
      }),
    [convertToBudgetItem],
  );
  const onPushPreview = useCallback(
    (items: PushPreviewItem[], goalId?: number) => {
      setPendingPushGoalId(goalId);
      setPushPreviewItems(items);
    },
    [],
  );
  const onDeleteOverride = useCallback(
    (params: { goalId: number; monthDate: string }) =>
      deleteOverride.mutate(params),
    [deleteOverride],
  );

  return {
    // State for ApiSyncSection component
    linkingGoalId,
    setLinkingGoalId,
    pushPreviewItems,
    setPushPreviewItems,
    pendingPushGoalId,
    setPendingPushGoalId,
    // Callbacks for header buttons
    pushToApiPending: pushToApi.isPending,
    // Callbacks for FundManagementSection
    onLinkToApi,
    onUnlinkFromApi,
    onConvertToBudgetItem,
    onPushPreview,
    // Callback for FundManagementSection → FundCard → FundOverridesSummary
    onDeleteOverride,
    // Build push-all preview from current goals
    buildPushAllPreview: (
      rawGoals: RawGoal[],
      apiBalanceMap: Map<
        number,
        { balance: number; budgeted: number; activity: number }
      >,
    ) => {
      const items: PushPreviewItem[] = [];
      for (const g of rawGoals) {
        if (!g.isApiSyncEnabled || !g.apiCategoryId) continue;
        const amount = parseFloat(g.monthlyContribution ?? "0") || 0;
        const currentBudgeted = apiBalanceMap.get(g.id)?.budgeted ?? 0;
        items.push({
          name: g.name,
          field: "Goal Target",
          currentYnab: currentBudgeted,
          newValue: amount,
        });
        const target = parseFloat(g.targetAmount ?? "0") || 0;
        if (target > 0) {
          items.push({
            name: g.name,
            field: "Goal Target",
            currentYnab: target,
            newValue: target,
          });
        }
      }
      setPendingPushGoalId(undefined);
      setPushPreviewItems(items);
    },
  };
}
