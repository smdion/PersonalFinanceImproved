/**
 * The budget and savings pushes reload the page's data when they fail, so a
 * push that stopped partway shows what it wrote. The global toast (not
 * these hooks) says what happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetTrpcMock, setMutationError, utilsCalls } from "./trpc-mock";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

import { useSyncMutations } from "@/components/budget/use-sync-mutations";
import { useApiSync } from "@/components/savings/api-sync-section";

const stopped = new Error("Pushed 2 of 5 categories, then failed");

beforeEach(() => {
  vi.clearAllMocks();
  resetTrpcMock();
});

describe("push reloads on error", () => {
  it("budget push invalidates the summary", () => {
    setMutationError("budget.syncBudgetToApi", stopped);
    const { result } = renderHook(() => useSyncMutations());
    act(() => result.current.syncToApi.mutate({}));
    expect(
      utilsCalls("budget.computeActiveSummary.invalidate"),
    ).not.toHaveLength(0);
    expect(utilsCalls("budget.listApiActuals.invalidate")).not.toHaveLength(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("savings push invalidates savings", () => {
    setMutationError("savings.pushContributionsToApi", stopped);
    const { result } = renderHook(() => useApiSync());
    act(() => result.current.pushToApi.mutate({}));
    expect(utilsCalls("savings.invalidate")).not.toHaveLength(0);
    expect(toastError).not.toHaveBeenCalled();
  });
});
