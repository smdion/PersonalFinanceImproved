/**
 * The budget and savings pushes reload the page's data when they fail, so a
 * push that stopped partway shows what it wrote. The global toast (not
 * these hooks) says what happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

type MutationOpts = { onError?: (e: unknown) => void };

const { invalidate, toastError, mutationOpts, utils, router } = vi.hoisted(
  () => {
    const invalidate = {
      computeActiveSummary: vi.fn(),
      listApiActuals: vi.fn(),
      savings: vi.fn(),
    };
    const toastError = vi.fn();
    const mutationOpts: Record<string, MutationOpts> = {};

    /** Any `trpc.a.b.useMutation(opts)` records opts under "a.b". */
    function router(path: string[]): unknown {
      return new Proxy(() => {}, {
        get: (_t, key: string) => {
          if (key === "useMutation")
            return (opts: MutationOpts = {}) => {
              mutationOpts[path.join(".")] = opts;
              return { mutate: vi.fn(), isPending: false };
            };
          if (key === "useQuery") return () => ({ data: undefined });
          return router([...path, key]);
        },
      });
    }

    const utils = {
      budget: {
        computeActiveSummary: { invalidate: invalidate.computeActiveSummary },
        listApiActuals: { invalidate: invalidate.listApiActuals },
      },
      savings: { invalidate: invalidate.savings },
    };
    return { invalidate, toastError, mutationOpts, utils, router };
  },
);

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get: (_t, key: string) =>
        key === "useUtils" ? () => utils : router([key]),
    },
  ),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

import { useSyncMutations } from "@/components/budget/hooks/use-sync-mutations";
import { useApiSync } from "@/components/savings/api-sync-section";

const stopped = new Error("Pushed 2 of 5 categories, then failed");

beforeEach(() => vi.clearAllMocks());

describe("push reloads on error", () => {
  it("budget push invalidates the summary", () => {
    renderHook(() => useSyncMutations());
    mutationOpts["budget.syncBudgetToApi"]!.onError!(stopped);
    expect(invalidate.computeActiveSummary).toHaveBeenCalled();
    expect(invalidate.listApiActuals).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("savings push invalidates savings", () => {
    renderHook(() => useApiSync());
    mutationOpts["savings.pushContributionsToApi"]!.onError!(stopped);
    expect(invalidate.savings).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
