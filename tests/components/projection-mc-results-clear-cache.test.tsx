/**
 * Regression test for a live-household bug: the "Clear
 * Cache" button in McResultsSection wiped the SERVER-side
 * `projection_cache` table (confirmed working, via `clearProjectionCache`)
 * but never invalidated the BROWSER's own client-side `computeProjection`
 * query cache — so a household that changed `rothBracketTarget` and hit
 * "Clear Cache" kept seeing the old projection numbers in their already-
 * open tab, because nothing told that tab to actually refetch. The
 * server would have recomputed fresh on its NEXT request; the bug was
 * that the client never made one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { McResultsSection } from "@/components/cards/projection/projection-mc-results";
import type { ProjectionState } from "@/components/cards/projection/projection-table-types";

const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      projection: { invalidate: mockInvalidate },
    }),
  },
}));

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

function baseState(overrides: Partial<ProjectionState> = {}): ProjectionState {
  const clearProjectionCacheMutation = {
    mutate: vi.fn(),
    isPending: false,
  };
  const state = {
    result: { projectionByYear: [] },
    projectionMode: "monteCarlo" as const,
    mcLoading: false,
    mcQuery: {
      error: null,
      data: {
        result: { warnings: [], numTrials: 1000 },
        simulationInputs: {
          preset: "default",
          presetLabel: "Default",
          taxMode: "simple",
          hasAssetClassOverrides: false,
          blendedReturn: 0.07,
          blendedVol: 0.12,
          withdrawalRate: 0.04,
          withdrawalStrategy: "fixed",
          inflationRisk: { meanRate: 0.025, stdDev: 0.01 },
          computedAt: null,
        },
      },
    },
    setShowAssumptions: vi.fn(),
    runMonteCarlo: vi.fn(),
    runCoastFireMc: vi.fn(),
    clearProjectionCacheMutation,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return state as ProjectionState;
}

describe("McResultsSection — Clear Cache client-invalidation", () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
  });

  it("invalidates the client-side projection query cache once the server-side clear succeeds", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = baseState();
    render(<McResultsSection state={state} />);

    fireEvent.click(screen.getByText("Clear Cache"));

    // The mutation's own success handler is what triggers invalidation --
    // simulate the mutation resolving successfully, same as the real
    // clearProjectionCacheMutation would after clearProjectionCache()
    // deletes the server-side rows.
    const [, options] = (
      state.clearProjectionCacheMutation.mutate as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    options.onSuccess({ cleared: 5 });

    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("doesn't clear anything (or invalidate) when the user cancels the confirm dialog", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const state = baseState();
    render(<McResultsSection state={state} />);

    fireEvent.click(screen.getByText("Clear Cache"));

    expect(state.clearProjectionCacheMutation.mutate).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
