/**
 * The budget page's mutation hooks: which procedure each mutation calls,
 * which queries it invalidates when it settles, and the sync toasts. Pins
 * the invalidation sets so a rename or regrouping of the hooks can't change
 * what refetches after a write.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import {
  resetTrpcMock,
  mutationCalls,
  setMutationResult,
  setQuery,
  utilsCalledPaths,
  type MutationPath,
} from "../components/trpc-mock";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  toast: {
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    undo: vi.fn(),
  },
}));

import { useBudgetItemMutations } from "@/components/budget/use-budget-item-mutations";
import { useBudgetProfileMutations } from "@/components/budget/use-budget-profile-mutations";
import { useBudgetColumnMutations } from "@/components/budget/use-budget-column-mutations";
import { useBudgetSyncMutations } from "@/components/budget/use-budget-sync-mutations";

const SUMMARY = [
  "budget.computeActiveSummary.invalidate",
  "budget.listApiActuals.invalidate",
  "savings.invalidate",
];
const PROFILES = ["budget.listProfiles.invalidate"];
const SUMMARY_AND_PROFILES = [...SUMMARY, ...PROFILES];
const SUMMARY_AND_CONTRIBUTIONS = [
  ...SUMMARY,
  "paycheck.invalidate",
  "contribution.invalidate",
  "retirement.invalidate",
  "projection.invalidate",
  "brokerage.invalidate",
  "contribution.accounts.invalidate",
];

/** A mutation key, the procedure it calls and what it invalidates. */
type Row = [key: string, path: MutationPath, invalidates: string[]];

const ITEM: Row[] = [
  ["updateCell", "budget.updateItemAmount", SUMMARY_AND_CONTRIBUTIONS],
  ["deleteItem", "budget.deleteItem", SUMMARY],
  ["updateItemEssential", "budget.updateItemEssential", SUMMARY],
  ["updateCategoryEssential", "budget.updateCategoryEssential", SUMMARY],
  ["updateBatch", "budget.updateItemAmounts", SUMMARY_AND_CONTRIBUTIONS],
  ["moveItem", "budget.moveItem", SUMMARY],
  ["reorderItem", "budget.reorderItem", SUMMARY],
  ["reorderCategory", "budget.reorderCategory", SUMMARY],
  ["createItem", "budget.createItem", SUMMARY],
  ["convertToGoal", "savings.convertBudgetItemToGoal", SUMMARY],
];
const PROFILE: Row[] = [
  ["setActiveProfile", "budget.setActiveProfile", SUMMARY_AND_PROFILES],
  ["createProfile", "budget.createProfile", PROFILES],
  ["deleteProfile", "budget.deleteProfile", PROFILES],
  ["renameProfile", "budget.renameProfile", PROFILES],
  ["duplicateProfile", "budget.duplicateProfile", PROFILES],
];
const COLUMN: Row[] = [
  ["addColumn", "budget.addColumn", SUMMARY],
  ["removeColumn", "budget.removeColumn", SUMMARY],
  ["renameColumn", "budget.renameColumn", SUMMARY],
  ["updateColumnMonths", "budget.updateColumnMonths", SUMMARY_AND_PROFILES],
];
const SYNC: Row[] = [
  ["syncFromApi", "budget.syncBudgetFromApi", SUMMARY],
  ["syncToApi", "budget.syncBudgetToApi", SUMMARY],
];

const selectedColumnRef: MutableRefObject<number> = { current: 0 };
const HOOKS: [name: string, hook: () => object, rows: Row[]][] = [
  ["item", () => useBudgetItemMutations({ selectedColumnRef }), ITEM],
  ["profile", useBudgetProfileMutations, PROFILE],
  ["column", useBudgetColumnMutations, COLUMN],
  ["sync", useBudgetSyncMutations, SYNC],
];

beforeEach(() => {
  vi.clearAllMocks();
  resetTrpcMock();
  setMutationResult("budget.syncBudgetFromApi", { updated: 3 });
  setMutationResult("budget.syncBudgetToApi", {
    pushed: 2,
    service: "actual",
    skippedUnsupported: 1,
  });
});

async function settle() {
  // The optimistic mutations await cancel() before they fire.
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("budget mutation hooks — invalidation sets", () => {
  for (const [name, hook, rows] of HOOKS) {
    it(`the ${name} hook returns exactly these mutations`, () => {
      const { result } = renderHook(hook);
      expect(Object.keys(result.current).sort()).toEqual(
        rows.map(([key]) => key).sort(),
      );
    });

    for (const [key, path, invalidates] of rows) {
      it(`${name}.${key} calls ${path} and invalidates its set`, async () => {
        const { result } = renderHook(hook);
        const mutation = (result.current as Record<string, unknown>)[key] as {
          mutate: (input: never) => void;
        };
        await act(async () => {
          mutation.mutate({ id: 1, colIndex: 0, amount: 5 } as never);
          await settle();
        });
        expect(mutationCalls(path)).toHaveLength(1);
        expect(
          utilsCalledPaths().filter((p) => p.endsWith(".invalidate")),
        ).toEqual([...invalidates].sort());
      });
    }
  }
});

describe("budget sync toasts", () => {
  it("a pull names the active budget service", async () => {
    setQuery("sync.getActiveBudgetApi", "ynab");
    const { result } = renderHook(() => useBudgetSyncMutations());
    await act(async () => {
      result.current.syncFromApi.mutate({});
      await settle();
    });
    expect(toastSuccess.mock.calls).toEqual([["Pulled 3 items from YNAB"]]);
  });

  it("a push to Actual says it lands as a goal template", async () => {
    const { result } = renderHook(() => useBudgetSyncMutations());
    await act(async () => {
      result.current.syncToApi.mutate({});
      await settle();
    });
    expect(toastSuccess.mock.calls).toEqual([
      [
        'Pushed 2 items to Actual Budget (1 skipped — check Actual Budget) as a goal template — open Actual Budget and run "Apply Budget Template" to assign it to a month\'s budget.',
      ],
    ]);
  });
});
