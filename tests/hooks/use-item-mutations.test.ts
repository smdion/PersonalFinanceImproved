/**
 * Regression test for updateCell's optimistic cache patch on
 * contribution-linked budget items.
 *
 * THE BUG. The optimistic patch only wrote `contribAmount` (the
 * selected-column-only field), never `contribAmounts` (the per-column
 * array). But getCatTotals/the "PC" badge both prefer `contribAmounts[col]`
 * over `contribAmount` when present — so for any item whose cache already
 * had a `contribAmounts` array, the optimistic edit was invisible: the
 * stale array value kept winning until the refetch landed.
 *
 * Also covers: the patch must skip entirely when this column's
 * `contribStatus` isn't "ok" (the server-side edit legitimately no-ops
 * whenever the linked account isn't fully resolvable for this column —
 * patching optimistically would show a value the refetch silently
 * reverts), and must clone rather than mutate the existing
 * `contribAmounts` array in place.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useItemMutations } from "@/components/budget/hooks/use-item-mutations";
import type { MutableRefObject } from "react";
import type { ContribResolutionStatus } from "@/lib/pure/profiles";

type RawItemLike = {
  id: number;
  contributionAccountId: number | null;
  contribStatus?: ContribResolutionStatus[] | null;
  contribAmount?: number | null;
  contribAmounts?: number[] | null;
  amounts: number[];
};

let cachedData: { rawItems: RawItemLike[] } | undefined;

const cancel = vi.fn();
const getData = vi.fn(() => cachedData);
const setData = vi.fn(
  (_input: unknown, updater: unknown | ((prev: unknown) => unknown)) => {
    cachedData = (
      typeof updater === "function"
        ? (updater as (prev: unknown) => unknown)(cachedData)
        : updater
    ) as typeof cachedData;
  },
);

const stableUtils = {
  budget: {
    computeActiveSummary: { cancel, getData, setData, invalidate: vi.fn() },
    listApiActuals: { invalidate: vi.fn() },
    listProfiles: { invalidate: vi.fn() },
  },
  savings: { invalidate: vi.fn() },
  paycheck: { invalidate: vi.fn() },
  contribution: { invalidate: vi.fn() },
  retirement: { invalidate: vi.fn() },
  projection: { invalidate: vi.fn() },
  brokerage: { invalidate: vi.fn() },
  settings: { contributionAccounts: { invalidate: vi.fn() } },
};

const makeMutation = () => ({ mutate: vi.fn(), isPending: false });

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => stableUtils,
    budget: {
      updateItemAmount: { useMutation: () => makeMutation() },
      deleteItem: { useMutation: () => makeMutation() },
      updateItemEssential: { useMutation: () => makeMutation() },
      updateCategoryEssential: { useMutation: () => makeMutation() },
      updateItemAmounts: { useMutation: () => makeMutation() },
      moveItem: { useMutation: () => makeMutation() },
      reorderItem: { useMutation: () => makeMutation() },
      reorderCategory: { useMutation: () => makeMutation() },
      createItem: { useMutation: () => makeMutation() },
    },
    savings: {
      convertBudgetItemToGoal: { useMutation: () => makeMutation() },
    },
  },
}));

function setup() {
  const selectedColumnRef: MutableRefObject<number> = { current: 0 };
  return renderHook(() => useItemMutations({ selectedColumnRef }));
}

async function flush() {
  // optimisticUpdate awaits cancel(), then .then(proceed) — two microtask
  // hops before the cache write lands.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useItemMutations — updateCell optimistic patch for linked items", () => {
  it("patches contribAmounts[col], not just contribAmount, for a linked complete item", async () => {
    cachedData = {
      rawItems: [
        {
          id: 1,
          contributionAccountId: 5,
          contribStatus: ["ok", "ok"],
          contribAmount: 100,
          contribAmounts: [100, 100],
          amounts: [0, 0],
        },
      ],
    };
    const { result } = setup();

    await act(async () => {
      result.current.updateCell.mutate({ id: 1, colIndex: 1, amount: 250 });
      await flush();
    });

    const patched = cachedData!.rawItems[0]!;
    expect(patched.contribAmount).toBe(250);
    expect(patched.contribAmounts).toEqual([100, 250]);
  });

  it("does not patch the item at all when this column's contribStatus isn't ok", async () => {
    const original: RawItemLike = {
      id: 2,
      contributionAccountId: 7,
      contribStatus: ["no_pay_period"],
      contribAmount: 50,
      contribAmounts: [50],
      amounts: [0],
    };
    cachedData = { rawItems: [original] };
    const { result } = setup();

    await act(async () => {
      result.current.updateCell.mutate({ id: 2, colIndex: 0, amount: 999 });
      await flush();
    });

    expect(cachedData!.rawItems[0]).toBe(original);
  });

  it("clones contribAmounts rather than mutating the cached array in place", async () => {
    const originalContribAmounts = [10, 20];
    cachedData = {
      rawItems: [
        {
          id: 3,
          contributionAccountId: 9,
          contribStatus: ["ok"],
          contribAmount: 10,
          contribAmounts: originalContribAmounts,
          amounts: [0, 0],
        },
      ],
    };
    const { result } = setup();

    await act(async () => {
      result.current.updateCell.mutate({ id: 3, colIndex: 0, amount: 77 });
      await flush();
    });

    expect(originalContribAmounts).toEqual([10, 20]);
  });
});
