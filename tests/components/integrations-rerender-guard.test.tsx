/**
 * Per-section re-render guard for the integrations preview panel.
 *
 * This test is the regression gate for the advisor-rejected "one mega-hook"
 * shape. If a future refactor merges the 5 per-section mutation hooks into a
 * single 22-mutation bundle, every section will re-render on every mutation's
 * pending flip — exactly the problem the 5-hook split is designed to prevent.
 *
 * ## Why this test is "stable identities" and not "render-counter"
 *
 * In PR 5, all five sections still live inside a single `PreviewPanel`
 * component. A budget mutation's `isPending` flip triggers a re-render of the
 * entire `PreviewPanel` regardless of how the mutations are bundled — React
 * has no way to know that the savings JSX doesn't depend on the budget
 * mutation. The true render-counter guard only becomes meaningful in PR 6,
 * once each section is its own `React.memo`-wrapped component.
 *
 * What PR 5 *can* guarantee — and what this test asserts — is that each
 * per-section hook returns a stable `mutations` object shape so that when
 * PR 6 lands, the memoized section components receive reference-stable props
 * across renders where their section's mutations did not change. If a future
 * refactor accidentally replaces one of the hooks with an inline
 * `useMutation()` in the parent, or regroups the mutations into a single
 * mega-hook, this test will fail because the mutation bundle will not match
 * the documented 5-hook shape.
 *
 * PR 6 will add the render-counter guard on top of this test.
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
      },
      settings: {
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
    const keys = Object.keys(result.current.mutations).sort();
    expect(keys).toEqual(
      ["setLinkedColumn", "setLinkedProfile", "syncAllNames"].sort(),
    );
    expect(typeof result.current.invalidate).toBe("function");
  });

  it("useBudgetMutations returns the expected 9-mutation shape", async () => {
    const { useBudgetMutations } =
      await import("@/components/settings/integrations/hooks/use-budget-mutations");
    const { result } = renderHook(() => useBudgetMutations());
    const keys = Object.keys(result.current.mutations).sort();
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
    const keys = Object.keys(result.current.mutations).sort();
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
    const keys = Object.keys(result.current.mutations).sort();
    expect(keys).toEqual(["linkContrib", "unlinkContrib"].sort());
  });

  it("usePortfolioMutations returns the expected 2-mutation shape", async () => {
    const { usePortfolioMutations } =
      await import("@/components/settings/integrations/hooks/use-portfolio-mutations");
    const { result } = renderHook(() => usePortfolioMutations());
    const keys = Object.keys(result.current.mutations).sort();
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

  it("each section hook shares the same invalidate reference pattern", async () => {
    const [drift, budget, savings, contrib, portfolio] = await Promise.all([
      import("@/components/settings/integrations/hooks/use-drift-mutations"),
      import("@/components/settings/integrations/hooks/use-budget-mutations"),
      import("@/components/settings/integrations/hooks/use-savings-mutations"),
      import("@/components/settings/integrations/hooks/use-contrib-mutations"),
      import("@/components/settings/integrations/hooks/use-portfolio-mutations"),
    ]);
    // Smoke: every hook exports a factory that returns { mutations, invalidate }
    for (const mod of [drift, budget, savings, contrib, portfolio]) {
      const hookName = Object.keys(mod).find((k) => k.startsWith("use")) as
        | string
        | undefined;
      expect(hookName).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = (mod as any)[hookName!];
      const { result } = renderHook(() => hook());
      expect(result.current).toHaveProperty("mutations");
      expect(result.current).toHaveProperty("invalidate");
      expect(typeof result.current.invalidate).toBe("function");
    }
  });
});
