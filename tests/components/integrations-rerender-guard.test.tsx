/**
 * Per-section re-render guard for the integrations preview panel.
 *
 * This test is the regression gate for the advisor-rejected "one mega-hook"
 * shape. If a future refactor merges the 5 per-section mutation hooks into a
 * single 22-mutation bundle, every section will re-render on every mutation's
 * pending flip — exactly the problem the 5-hook split is designed to prevent.
 *
 * Each hook returns a flat `{ mutationName: UseMutationResult, ... }` object
 * per CONTRIBUTING.md's Mutation Hook Convention (no `{ mutations: {...},
 * invalidate }` wrapper — `invalidate` is used internally as each
 * mutation's own `onSuccess` and is not part of the public return). This
 * test asserts each hook's flat key set so that a future refactor that
 * reintroduces the wrapper, drops a mutation, or regroups the 5 hooks into
 * one mega-hook fails here rather than silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  mutationCalls,
  resetTrpcMock,
  utilsCalledPaths,
  utilsCalls,
  type MutationPath,
} from "./trpc-mock";

// Mock tRPC before importing the hooks. trpc-mock's useUtils() returns one
// stable object across renders, as tRPC's real one does: the
// useCallback-based invalidate hook relies on that for its dependency
// array, and a fresh object each call would break the guard below.
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

beforeEach(() => {
  resetTrpcMock();
});

describe("integrations per-section mutation hooks — re-render guard", () => {
  it("useIntegrationDriftMutations returns the expected 3-mutation shape", async () => {
    const { useIntegrationDriftMutations } =
      await import("@/components/settings/integrations/use-integration-drift-mutations");
    const { result } = renderHook(() => useIntegrationDriftMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(
      ["setLinkedColumn", "setLinkedProfile", "syncAllNames"].sort(),
    );
  });

  it("useIntegrationBudgetMutations returns the expected 9-mutation shape", async () => {
    const { useIntegrationBudgetMutations } =
      await import("@/components/settings/integrations/use-integration-budget-mutations");
    const { result } = renderHook(() => useIntegrationBudgetMutations());
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

  it("useIntegrationSavingsMutations returns the expected 6-mutation shape", async () => {
    const { useIntegrationSavingsMutations } =
      await import("@/components/settings/integrations/use-integration-savings-mutations");
    const { result } = renderHook(() => useIntegrationSavingsMutations());
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

  it("useIntegrationContributionAccountMutations returns the expected 2-mutation shape", async () => {
    const { useIntegrationContributionAccountMutations } =
      await import("@/components/settings/integrations/use-integration-contribution-account-mutations");
    const { result } = renderHook(() =>
      useIntegrationContributionAccountMutations(),
    );
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["linkContrib", "unlinkContrib"].sort());
  });

  it("useIntegrationPortfolioMutations returns the expected 2-mutation shape", async () => {
    const { useIntegrationPortfolioMutations } =
      await import("@/components/settings/integrations/use-integration-portfolio-mutations");
    const { result } = renderHook(() => useIntegrationPortfolioMutations());
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["createAssetAndMap", "updateMappings"].sort());
  });

  it("useInvalidatePreview returns a stable callback across re-renders", async () => {
    const { useInvalidatePreview } =
      await import("@/components/settings/integrations/use-invalidate-preview");
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
    expect(utilsCalls("sync.getPreview.invalidate")).toHaveLength(1);
  });

  it("every mutation calls its procedure and invalidates only the preview", async () => {
    const [drift, budget, savings, contrib, portfolio] = await Promise.all([
      import("@/components/settings/integrations/use-integration-drift-mutations"),
      import("@/components/settings/integrations/use-integration-budget-mutations"),
      import("@/components/settings/integrations/use-integration-savings-mutations"),
      import("@/components/settings/integrations/use-integration-contribution-account-mutations"),
      import("@/components/settings/integrations/use-integration-portfolio-mutations"),
    ]);
    const table: [() => object, [string, MutationPath][]][] = [
      [
        drift.useIntegrationDriftMutations,
        [
          ["syncAllNames", "sync.syncAllNames"],
          ["setLinkedProfile", "sync.setLinkedProfile"],
          ["setLinkedColumn", "sync.setLinkedColumn"],
        ],
      ],
      [
        budget.useIntegrationBudgetMutations,
        [
          ["linkBudget", "budget.linkToApi"],
          ["unlinkBudget", "budget.unlinkFromApi"],
          ["createItem", "budget.createItem"],
          ["skipCategory", "sync.skipCategory"],
          ["unskipCategory", "sync.unskipCategory"],
          ["renameBudgetToApi", "sync.renameBudgetItemToApi"],
          ["renameBudgetApiName", "sync.renameBudgetItemApiName"],
          ["moveBudgetToApiGroup", "sync.moveBudgetItemToApiGroup"],
          ["setBudgetSyncDir", "budget.setSyncDirection"],
        ],
      ],
      [
        savings.useIntegrationSavingsMutations,
        [
          ["linkSavings", "savings.linkGoalToApi"],
          ["unlinkSavings", "savings.unlinkGoalFromApi"],
          ["renameSavingsToApi", "sync.renameSavingsGoalToApi"],
          ["renameSavingsApiName", "sync.renameSavingsGoalApiName"],
          ["linkReimbursement", "savings.linkReimbursementCategory"],
          ["createGoal", "savings.savingsGoals.create"],
        ],
      ],
      [
        contrib.useIntegrationContributionAccountMutations,
        [
          ["linkContrib", "budget.linkContributionAccount"],
          ["unlinkContrib", "budget.unlinkContributionAccount"],
        ],
      ],
      [
        portfolio.useIntegrationPortfolioMutations,
        [
          ["updateMappings", "sync.updateAccountMappings"],
          ["createAssetAndMap", "sync.createAssetAndMap"],
        ],
      ],
    ];
    for (const [hook, rows] of table) {
      for (const [key, path] of rows) {
        resetTrpcMock();
        const { result } = renderHook(hook);
        const mutation = (result.current as Record<string, unknown>)[key] as {
          mutate: (input: never) => void;
        };
        act(() => mutation.mutate({} as never));
        expect(mutationCalls(path), `${key} → ${path}`).toHaveLength(1);
        expect(utilsCalledPaths(), key).toEqual(["sync.getPreview.invalidate"]);
        expect(utilsCalls("sync.getPreview.invalidate"), key).toHaveLength(1);
      }
    }
  });

  it("every section hook returns a flat mutation bundle, not a { mutations, invalidate } wrapper", async () => {
    const [drift, budget, savings, contrib, portfolio] = await Promise.all([
      import("@/components/settings/integrations/use-integration-drift-mutations"),
      import("@/components/settings/integrations/use-integration-budget-mutations"),
      import("@/components/settings/integrations/use-integration-savings-mutations"),
      import("@/components/settings/integrations/use-integration-contribution-account-mutations"),
      import("@/components/settings/integrations/use-integration-portfolio-mutations"),
    ]);
    // Smoke: every hook exports a factory whose return is flat — each value
    // is a mutation object (has `.mutate`), and neither `mutations` nor
    // `invalidate` appears as a top-level key. Guards against CONTRIBUTING.md's
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
