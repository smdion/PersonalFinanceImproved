/**
 * Per-section re-render guard for the integrations preview panel.
 *
 * This test is the regression gate for the advisor-rejected "one mega-hook"
 * shape. If a future refactor merges the 5 per-section mutation hooks into a
 * single 22-mutation bundle, every section will re-render on every mutation's
 * pending flip — exactly the problem the 5-hook split is designed to prevent.
 *
 * Each hook returns a flat `{ mutationName: UseMutationResult, ... }` object
 * per RULES.md's Mutation Hook Convention (no `{ mutations: {...},
 * invalidate }` wrapper — `invalidate` is used internally as each
 * mutation's own `onSuccess` and is not part of the public return). This
 * test asserts each hook's flat key set so that a future refactor that
 * reintroduces the wrapper, drops a mutation, or regroups the 5 hooks into
 * one mega-hook fails here rather than silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock tRPC before importing the hooks. We capture the `onSuccess` callback
// passed to each useMutation so that an optional follow-up test can fire it
// and observe the invalidate path, but the primary assertion is on the
// shape + stability of the returned mutation bundle.
const makeMutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  data: null,
  error: null,
  reset: vi.fn(),
});

const invalidatePreview = vi.fn();
// Stable utils reference — tRPC's real useUtils() returns a stable object
// across renders, and our useCallback-based invalidate hook relies on that
// stability for its dependency array. A fresh object each call would force a
// new callback each render and break the anti-tRPC-anti-pattern guard below.
const stableUtils = {
  sync: {
    getPreview: { invalidate: invalidatePreview },
  },
};

vi.mock("@/lib/trpc", () => {
  const mutationFactory = () => ({
    useMutation: (_opts?: { onSuccess?: () => void }) => makeMutation(),
  });

  return {
    trpc: {
      useUtils: () => stableUtils,
      sync: {
        syncAllNames: mutationFactory(),
        setLinkedProfile: mutationFactory(),
        setLinkedColumn: mutationFactory(),
        skipCategory: mutationFactory(),
        unskipCategory: mutationFactory(),
        renameBudgetItemToApi: mutationFactory(),
        renameBudgetItemApiName: mutationFactory(),
        moveBudgetItemToApiGroup: mutationFactory(),
        renameSavingsGoalToApi: mutationFactory(),
        renameSavingsGoalApiName: mutationFactory(),
        updateAccountMappings: mutationFactory(),
        createAssetAndMap: mutationFactory(),
      },
      budget: {
        linkToApi: mutationFactory(),
        unlinkFromApi: mutationFactory(),
        createItem: mutationFactory(),
        setSyncDirection: mutationFactory(),
        linkContributionAccount: mutationFactory(),
        unlinkContributionAccount: mutationFactory(),
      },
      savings: {
        linkGoalToApi: mutationFactory(),
        unlinkGoalFromApi: mutationFactory(),
        linkReimbursementCategory: mutationFactory(),
        savingsGoals: {
          create: mutationFactory(),
        },
      },
    },
  };
});

beforeEach(() => {
  invalidatePreview.mockClear();
});

describe("integrations per-section mutation hooks — re-render guard", () => {
  it("useDriftMutations returns the expected 3-mutation shape", async () => {
    const { useDriftMutations } =
      await import("@/components/settings/integrations/hooks/use-drift-mutations");
    const { result } = renderHook(() => useDriftMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(
      ["setLinkedColumn", "setLinkedProfile", "syncAllNames"].sort(),
    );
  });

  it("useBudgetMutations returns the expected 9-mutation shape", async () => {
    const { useBudgetIntegrationsMutations } =
      await import("@/components/settings/integrations/hooks/use-budget-mutations");
    const { result } = renderHook(() => useBudgetIntegrationsMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(
      [
        "createItem",
        "linkBudget",
        "moveBudgetToApiGroup",
        "renameBudgetApiName",
        "renameBudgetToApi",
        "setBudgetSyncDir",
        "skipCategory",
        "unlinkBudget",
        "unskipCategory",
      ].sort(),
    );
  });

  it("useSavingsMutations returns the expected 6-mutation shape", async () => {
    const { useSavingsMutations } =
      await import("@/components/settings/integrations/hooks/use-savings-mutations");
    const { result } = renderHook(() => useSavingsMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(
      [
        "createGoal",
        "linkReimbursement",
        "linkSavings",
        "renameSavingsApiName",
        "renameSavingsToApi",
        "unlinkSavings",
      ].sort(),
    );
  });

  it("useContribMutations returns the expected 2-mutation shape", async () => {
    const { useContribMutations } =
      await import("@/components/settings/integrations/hooks/use-contrib-mutations");
    const { result } = renderHook(() => useContribMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["linkContrib", "unlinkContrib"].sort());
  });

  it("usePortfolioMutations returns the expected 2-mutation shape", async () => {
    const { usePortfolioMutations } =
      await import("@/components/settings/integrations/hooks/use-portfolio-mutations");
    const { result } = renderHook(() => usePortfolioMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["createAssetAndMap", "updateMappings"].sort());
  });

  it("useInvalidatePreview returns a stable callback across re-renders", async () => {
    const { useInvalidatePreview } =
      await import("@/components/settings/integrations/hooks/use-invalidate-preview");
    const { result, rerender } = renderHook(() => useInvalidatePreview());
    const first = result.current;
    rerender();
    const second = result.current;
    // Reference stability protects `onSuccess` identity in the per-section
    // hooks — if this flips, every mutation passed to useMutation would get a
    // new onSuccess each render, which is the tRPC anti-pattern we're
    // guarding against.
    expect(second).toBe(first);
    first();
    expect(invalidatePreview).toHaveBeenCalledTimes(1);
  });

  it("every section hook returns a flat mutation bundle, not a { mutations, invalidate } wrapper", async () => {
    const [drift, budget, savings, contrib, portfolio] = await Promise.all([
      import("@/components/settings/integrations/hooks/use-drift-mutations"),
      import("@/components/settings/integrations/hooks/use-budget-mutations"),
      import("@/components/settings/integrations/hooks/use-savings-mutations"),
      import("@/components/settings/integrations/hooks/use-contrib-mutations"),
      import("@/components/settings/integrations/hooks/use-portfolio-mutations"),
    ]);
    // Smoke: every hook exports a factory whose return is flat — each value
    // is a mutation object (has `.mutate`), and neither `mutations` nor
    // `invalidate` appears as a top-level key. Guards against RULES.md's
    // Mutation Hook Convention wrapper shape creeping back in.
    for (const mod of [drift, budget, savings, contrib, portfolio]) {
      const hookName = Object.keys(mod).find((k) => k.startsWith("use")) as
        string | undefined;
      expect(hookName).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = (mod as any)[hookName!];
      const { result } = renderHook(() => hook());
      expect(result.current).not.toHaveProperty("mutations");
      expect(result.current).not.toHaveProperty("invalidate");
      const values = Object.values(result.current as Record<string, unknown>);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toHaveProperty("mutate");
        expect(value).toHaveProperty("isPending");
      }
    }
  });
});
