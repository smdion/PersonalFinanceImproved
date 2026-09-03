"use client";

import React, { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import {
  formatSyncResultToast,
  budgetApiServiceLabel,
} from "@/lib/utils/format";
import { resolveEffectiveMonthlyContribution } from "@/lib/calculators/savings-capacity";
import {
  PushPreviewModal,
  type PushPreviewItem,
} from "@/components/ui/push-preview-modal";
import type { RawGoal } from "./types";

/** The caller's already-resolved Contribution/Salary Profile selection —
 *  see computeLiveMaxMonthlyFunding's `income` param docblock (savings.ts)
 *  for why the recalculate/lock-in mutations need this threaded through
 *  explicitly rather than re-resolving it themselves. */
interface ProfileResolutionTiers {
  planPinId: number | null;
  localSelectionId: number | null;
  globalDefaultId: number | null;
}

export interface RecalcIncomeParams {
  contributionProfileId?: number;
  salaryProfileId?: number;
  salaryActiveFields?: { personId: number; salary: number }[];
  /** The raw tiers behind `contributionProfileId`/`salaryProfileId` — the
   *  mutation forwards these to budget.computeActiveSummary so that
   *  procedure's OWN per-column profile resolution (Plan pin > column pin >
   *  local selection > global default) matches what the client's own
   *  maxMonthlyFunding query used, not just the paycheck side (found live,
   *  2026-08-31, round two — see computeLiveMaxMonthlyFunding in savings.ts). */
  contributionProfileTiers?: ProfileResolutionTiers;
  salaryProfileTiers?: ProfileResolutionTiers;
}

interface ApiCategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
}

/** The single pushContributionsToApi mutation instance, owned by useApiSync()
 *  and passed down here — see useApiSync for why this must not be a second,
 *  independent useMutation() call. */
type PushMutation = ReturnType<
  typeof trpc.savings.pushContributionsToApi.useMutation
>;

/** Same single-instance rule as PushMutation — shared with the page's bulk
 *  "Pull In New Pay →" button and FundManagementSection's per-goal buttons. */
type RecalculateMutation = ReturnType<
  typeof trpc.savings.recalculateAllocation.useMutation
>;

/** Same single-instance rule as PushMutation — shared with the page's bulk
 *  "Update % (dollar unchanged)" button and FundManagementSection's
 *  per-goal buttons. */
type LockInMutation = ReturnType<
  typeof trpc.savings.lockInAllocationPercent.useMutation
>;

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
  pushMutation: PushMutation;
  recalcPreviewItems: PushPreviewItem[] | null;
  setRecalcPreviewItems: (items: PushPreviewItem[] | null) => void;
  pendingRecalcGoalId: number | undefined;
  setPendingRecalcGoalId: (id: number | undefined) => void;
  pendingRecalcProfileId: number | undefined;
  setPendingRecalcProfileId: (id: number | undefined) => void;
  pendingRecalcIncome: RecalcIncomeParams | undefined;
  setPendingRecalcIncome: (income: RecalcIncomeParams | undefined) => void;
  recalculateMutation: RecalculateMutation;
  lockInPreviewItems: PushPreviewItem[] | null;
  setLockInPreviewItems: (items: PushPreviewItem[] | null) => void;
  pendingLockInGoalId: number | undefined;
  setPendingLockInGoalId: (id: number | undefined) => void;
  pendingLockInProfileId: number | undefined;
  setPendingLockInProfileId: (id: number | undefined) => void;
  pendingLockInIncome: RecalcIncomeParams | undefined;
  setPendingLockInIncome: (income: RecalcIncomeParams | undefined) => void;
  lockInMutation: LockInMutation;
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
  pushMutation,
  recalcPreviewItems,
  setRecalcPreviewItems,
  pendingRecalcGoalId,
  setPendingRecalcGoalId,
  pendingRecalcProfileId,
  setPendingRecalcProfileId,
  pendingRecalcIncome,
  setPendingRecalcIncome,
  recalculateMutation,
  lockInPreviewItems,
  setLockInPreviewItems,
  pendingLockInGoalId,
  setPendingLockInGoalId,
  pendingLockInProfileId,
  setPendingLockInProfileId,
  pendingLockInIncome,
  setPendingLockInIncome,
  lockInMutation,
}: ApiSyncSectionProps) {
  const utils = trpc.useUtils();

  // Same single-service assumption as useApiSync's onUnlinkFromApi above —
  // this page has no per-service selector, so the currently active service
  // is the only correct, non-ambiguous target for a new link.
  const { data: activeService } = trpc.sync.getActiveBudgetApi.useQuery();

  // ── Mutations ──
  const linkGoalToApi = trpc.savings.linkGoalToApi.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });

  return (
    <>
      {/* API Category Linking Modal */}
      {linkingGoalId !== null && apiCategoriesData?.groups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface-primary max-h-96 w-80 overflow-y-auto rounded-lg p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-secondary text-sm font-semibold">
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
              <p className="text-faint py-4 text-center text-xs">
                No categories. Sync budget API first.
              </p>
            ) : (
              apiCategoriesData.groups.map((group) => (
                <div key={group.id} className="mb-2">
                  <div className="text-caption text-muted px-1 py-0.5 font-semibold tracking-wider uppercase">
                    {group.name}
                  </div>
                  {group.categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        if (!activeService || activeService === "none") return;
                        linkGoalToApi.mutate({
                          goalId: linkingGoalId,
                          service: activeService,
                          apiCategoryId: cat.id,
                          apiCategoryName: `${group.name}: ${cat.name}`,
                        });
                        setLinkingGoalId(null);
                      }}
                      className="text-secondary w-full rounded px-2 py-1 text-left text-xs hover:bg-blue-50"
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
          destinationLabel={apiBalancesData?.service?.toUpperCase() ?? "YNAB"}
          onConfirm={() => {
            pushMutation.mutate(
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
          isPending={pushMutation.isPending}
        />
      )}

      {/* Pull In New Pay preview modal — percent stays, dollar moves to match current income */}
      {recalcPreviewItems && (
        <PushPreviewModal
          title="Pull in new pay"
          items={recalcPreviewItems}
          direction="recalculate"
          onConfirm={() => {
            recalculateMutation.mutate(
              {
                ...(pendingRecalcGoalId !== undefined
                  ? { goalId: pendingRecalcGoalId }
                  : {}),
                ...(pendingRecalcProfileId !== undefined
                  ? { profileId: pendingRecalcProfileId }
                  : {}),
                ...pendingRecalcIncome,
              },
              {
                onSettled: () => {
                  setRecalcPreviewItems(null);
                  setPendingRecalcGoalId(undefined);
                  setPendingRecalcProfileId(undefined);
                  setPendingRecalcIncome(undefined);
                },
              },
            );
          }}
          onCancel={() => {
            setRecalcPreviewItems(null);
            setPendingRecalcGoalId(undefined);
            setPendingRecalcProfileId(undefined);
            setPendingRecalcIncome(undefined);
          }}
          isPending={recalculateMutation.isPending}
        />
      )}

      {/* Update % preview modal — dollar stays, percent moves to describe it against current income */}
      {lockInPreviewItems && (
        <PushPreviewModal
          title="Update % (dollar amounts unchanged)"
          items={lockInPreviewItems}
          direction="recalculate"
          valueFormat="percent"
          onConfirm={() => {
            lockInMutation.mutate(
              {
                ...(pendingLockInGoalId !== undefined
                  ? { goalId: pendingLockInGoalId }
                  : {}),
                ...(pendingLockInProfileId !== undefined
                  ? { profileId: pendingLockInProfileId }
                  : {}),
                ...pendingLockInIncome,
              },
              {
                onSettled: () => {
                  setLockInPreviewItems(null);
                  setPendingLockInGoalId(undefined);
                  setPendingLockInProfileId(undefined);
                  setPendingLockInIncome(undefined);
                },
              },
            );
          }}
          onCancel={() => {
            setLockInPreviewItems(null);
            setPendingLockInGoalId(undefined);
            setPendingLockInProfileId(undefined);
            setPendingLockInIncome(undefined);
          }}
          isPending={lockInMutation.isPending}
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

  // The main Savings page always operates on the currently active service
  // (there's no per-service selector here, unlike the Integrations sync
  // page) — apiBalanceMap/apiBalancesData are already resolved against this
  // same active service server-side.
  const { data: activeService } = trpc.sync.getActiveBudgetApi.useQuery();

  const unlinkGoalFromApi = trpc.savings.unlinkGoalFromApi.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const convertToBudgetItem = trpc.savings.convertGoalToBudgetItem.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      utils.budget.invalidate();
    },
  });
  // Single instance — also passed down to ApiSyncSection as `pushMutation`
  // so the toolbar button's pending state and the modal's confirm button
  // stay in sync. Previously ApiSyncSection created its own second,
  // independent useMutation() call, so the toolbar button's disabled/label
  // state never reflected an in-flight push at all.
  const pushToApi = trpc.savings.pushContributionsToApi.useMutation({
    onSuccess: (data) => {
      utils.savings.invalidate();
      const message = formatSyncResultToast(
        data.pushed,
        "push",
        budgetApiServiceLabel(data.service),
        data.skippedUnsupported,
        data.failed,
        data.failureMessage,
        // Actual's goal push only writes a #template note, not a live
        // budgeted amount — see formatSyncResultToast's requiresManualApply
        // docblock. YNAB writes the real goal field directly.
        data.service === "actual",
      );
      // A genuine failure with nothing pushed is a real error, not a
      // quiet "already up to date" — surface it as one (found live,
      // 2026-08-31: this previously always showed a success toast, even
      // when every single push attempt failed server-side).
      if (data.failed > 0 && data.pushed === 0) {
        toast.error(message);
      } else {
        toast.success(message);
      }
    },
  });
  const deleteOverride = trpc.savings.allocationOverrides.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  // Single instance — shared between the page's bulk "Pull In New Pay →"
  // button and FundManagementSection's per-goal buttons via a prop (same
  // reason as pushToApi above).
  const recalculateAllocation = trpc.savings.recalculateAllocation.useMutation({
    onSuccess: (result) => {
      utils.savings.invalidate();
      utils.budget.computeActiveSummary.invalidate();
      toast.success(
        result.updated > 0
          ? `Pulled in new pay for ${result.updated} goal${result.updated !== 1 ? "s" : ""}.`
          : "Nothing to update.",
      );
    },
    onError: (err) => toast.error(err.message || "Recalculate failed"),
  });
  // Single instance — shared between the page's bulk "Update % (dollar
  // unchanged)" button and FundManagementSection's per-goal buttons.
  const lockInAllocationPercent =
    trpc.savings.lockInAllocationPercent.useMutation({
      onSuccess: (result) => {
        utils.savings.invalidate();
        utils.budget.computeActiveSummary.invalidate();
        toast.success(
          result.updated > 0
            ? `Updated % for ${result.updated} goal${result.updated !== 1 ? "s" : ""} — dollar amounts unchanged.`
            : "Nothing to update.",
        );
      },
      onError: (err) => toast.error(err.message || "Update % failed"),
    });

  const [linkingGoalId, setLinkingGoalId] = useState<number | null>(null);
  const [pushPreviewItems, setPushPreviewItems] = useState<
    PushPreviewItem[] | null
  >(null);
  const [pendingPushGoalId, setPendingPushGoalId] = useState<
    number | undefined
  >(undefined);
  const [recalcPreviewItems, setRecalcPreviewItems] = useState<
    PushPreviewItem[] | null
  >(null);
  const [pendingRecalcGoalId, setPendingRecalcGoalId] = useState<
    number | undefined
  >(undefined);
  const [pendingRecalcProfileId, setPendingRecalcProfileId] = useState<
    number | undefined
  >(undefined);
  // Threaded into recalculateMutation/lockInMutation's `income` fields so
  // the live pool the MUTATION recomputes against can't diverge from what
  // this same preview just showed the household (found live, 2026-08-31 —
  // see computeLiveMaxMonthlyFunding's docblock, savings.ts).
  const [pendingRecalcIncome, setPendingRecalcIncome] = useState<
    RecalcIncomeParams | undefined
  >(undefined);
  const [lockInPreviewItems, setLockInPreviewItems] = useState<
    PushPreviewItem[] | null
  >(null);
  const [pendingLockInGoalId, setPendingLockInGoalId] = useState<
    number | undefined
  >(undefined);
  const [pendingLockInProfileId, setPendingLockInProfileId] = useState<
    number | undefined
  >(undefined);
  const [pendingLockInIncome, setPendingLockInIncome] = useState<
    RecalcIncomeParams | undefined
  >(undefined);

  const onLinkToApi = useCallback(
    (goalId: number) => setLinkingGoalId(goalId),
    [],
  );
  const onUnlinkFromApi = useCallback(
    (goalId: number) => {
      if (!activeService || activeService === "none") return;
      unlinkGoalFromApi.mutate({ goalId, service: activeService });
    },
    [unlinkGoalFromApi, activeService],
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
  const buildRecalculateAllPreview = useCallback(
    (
      rawGoals: RawGoal[],
      maxMonthlyFunding: number | null,
      goalId?: number,
      profileId?: number,
      income?: RecalcIncomeParams,
    ) => {
      const items: PushPreviewItem[] = [];
      for (const g of rawGoals) {
        if (!g.isActive || g.allocationPercent == null) continue;
        if (goalId !== undefined && g.id !== goalId) continue;
        const pct = parseFloat(g.allocationPercent);
        const stored = parseFloat(g.monthlyContribution ?? "0") || 0;
        const live = resolveEffectiveMonthlyContribution(
          pct,
          maxMonthlyFunding,
          stored,
        );
        items.push({
          name: g.name,
          field: "Monthly Contribution",
          currentYnab: stored,
          newValue: live,
        });
      }
      setPendingRecalcGoalId(goalId);
      setPendingRecalcProfileId(profileId);
      setPendingRecalcIncome(income);
      setRecalcPreviewItems(items);
    },
    [],
  );
  const buildLockInAllPreview = useCallback(
    (
      rawGoals: RawGoal[],
      maxMonthlyFunding: number | null,
      goalId?: number,
      profileId?: number,
      income?: RecalcIncomeParams,
    ) => {
      const items: PushPreviewItem[] = [];
      for (const g of rawGoals) {
        if (!g.isActive || g.allocationPercent == null) continue;
        if (goalId !== undefined && g.id !== goalId) continue;
        const currentPct = parseFloat(g.allocationPercent);
        const stored = parseFloat(g.monthlyContribution ?? "0") || 0;
        const newPct =
          maxMonthlyFunding != null && maxMonthlyFunding > 0
            ? (stored / maxMonthlyFunding) * 100
            : currentPct;
        items.push({
          name: g.name,
          field: "Allocation %",
          currentYnab: currentPct,
          newValue: newPct,
        });
      }
      setPendingLockInGoalId(goalId);
      setPendingLockInProfileId(profileId);
      setPendingLockInIncome(income);
      setLockInPreviewItems(items);
    },
    [],
  );

  return {
    // State for ApiSyncSection component
    linkingGoalId,
    setLinkingGoalId,
    pushPreviewItems,
    setPushPreviewItems,
    pendingPushGoalId,
    setPendingPushGoalId,
    recalcPreviewItems,
    setRecalcPreviewItems,
    pendingRecalcGoalId,
    setPendingRecalcGoalId,
    pendingRecalcProfileId,
    setPendingRecalcProfileId,
    pendingRecalcIncome,
    setPendingRecalcIncome,
    buildRecalculateAllPreview,
    lockInPreviewItems,
    setLockInPreviewItems,
    pendingLockInGoalId,
    setPendingLockInGoalId,
    pendingLockInProfileId,
    setPendingLockInProfileId,
    pendingLockInIncome,
    setPendingLockInIncome,
    buildLockInAllPreview,
    // Callbacks for header buttons
    pushToApiPending: pushToApi.isPending,
    // Single mutation instance — pass straight through to ApiSyncSection
    // (its `pushMutation` prop) so both consumers share the same state.
    pushToApi,
    // Single mutation instance — shared between the page's bulk button and
    // FundManagementSection's per-goal buttons (see declaration above).
    recalculateAllocation,
    // Single mutation instance — shared between the page's bulk button and
    // FundManagementSection's per-goal buttons (see declaration above).
    lockInAllocationPercent,
    // Callbacks for FundManagementSection
    onLinkToApi,
    onUnlinkFromApi,
    onConvertToBudgetItem,
    onPushPreview,
    // Callback for FundManagementSection → FundCard → FundOverridesSummary
    onDeleteOverride,
    // Build push-all preview from current goals. Pushes the STORED
    // monthlyContribution snapshot (matches what pushContributionsToApi
    // actually sends — see recalculateAllocation for the only path that's
    // allowed to move a percentage-based goal's amount). maxMonthlyFunding
    // is only used here to flag a percentage-based goal as "stale" when its
    // snapshot no longer matches what a live recalc would produce, so the
    // user gets a warning in the preview instead of silently pushing an
    // outdated amount.
    buildPushAllPreview: (
      rawGoals: RawGoal[],
      apiBalanceMap: Map<
        number,
        {
          balance: number;
          budgeted: number;
          activity: number;
          goalTarget: number | null;
        }
      >,
      efundComputedTarget?: number,
      maxMonthlyFunding?: number | null,
    ) => {
      const items: PushPreviewItem[] = [];
      for (const g of rawGoals) {
        if (!g.isApiSyncEnabled || !g.apiCategoryId) continue;
        const cat = apiBalanceMap.get(g.id);
        // currentYnab = existing YNAB goal target, not the budgeted (contribution) amount
        const currentYnab = cat?.goalTarget ?? 0;
        if (g.isEmergencyFund) {
          // E-fund: push computed target balance (targetMonths × essential expenses)
          const newValue = efundComputedTarget ?? 0;
          if (newValue > 0) {
            items.push({
              name: g.name,
              field: "Target Balance (TB)",
              currentYnab,
              newValue,
            });
          }
        } else {
          const allocationPercent =
            g.allocationPercent != null
              ? parseFloat(g.allocationPercent)
              : null;
          const amount = parseFloat(g.monthlyContribution ?? "0") || 0;
          const liveAmount = resolveEffectiveMonthlyContribution(
            allocationPercent,
            maxMonthlyFunding ?? null,
            amount,
          );
          const stale = Math.abs(liveAmount - amount) >= 0.01;
          if (amount > 0) {
            items.push({
              name: g.name,
              field: "Monthly Goal Target",
              currentYnab,
              newValue: amount,
              stale,
            });
          }
        }
      }
      setPendingPushGoalId(undefined);
      setPushPreviewItems(items);
    },
  };
}
