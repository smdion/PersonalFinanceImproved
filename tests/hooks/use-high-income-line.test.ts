/**
 * The high-income line is never shown wrong or stuck: undefined until the
 * saved setting has loaded (the default arriving first isn't the line when
 * one is saved), and `error` (the load's own) when the default fails with
 * nothing saved, so callers show it instead of a skeleton for good.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";

import {
  resetTrpcMock,
  setQuery,
  setQueryState,
} from "../components/trpc-mock";

const persisted = vi.fn();

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: () => persisted(),
}));
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

const DEFAULT = { threshold: 200_000, basis: "MFJ" } as const;

/** The default line failing to load. */
function defaultFails() {
  setQuery("contribution.computeHighIncomeLine", undefined);
  setQueryState("contribution.computeHighIncomeLine", {
    error: new Error("down"),
  });
}

beforeEach(() => {
  persisted.mockReset();
  resetTrpcMock();
});

describe("useHighIncomeLine", () => {
  it("waits for the saved setting even when the default has arrived", () => {
    persisted.mockReturnValue([null, vi.fn(), false]);
    setQuery("contribution.computeHighIncomeLine", DEFAULT);
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("uses the saved line once loaded, else the default", () => {
    setQuery("contribution.computeHighIncomeLine", DEFAULT);
    persisted.mockReturnValue([150_000, vi.fn(), true]);
    expect(renderHook(() => useHighIncomeLine()).result.current.threshold).toBe(
      150_000,
    );
    persisted.mockReturnValue([null, vi.fn(), true]);
    expect(renderHook(() => useHighIncomeLine()).result.current.threshold).toBe(
      200_000,
    );
  });

  it("the default failing with nothing saved is an error, not a lasting wait", () => {
    persisted.mockReturnValue([null, vi.fn(), true]);
    defaultFails();
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBeUndefined();
    expect(result.current.error).toEqual(new Error("down"));
    expect(result.current.isLoading).toBe(false);
  });

  it("a saved line doesn't need the default: its failure isn't an error", () => {
    persisted.mockReturnValue([150_000, vi.fn(), true]);
    defaultFails();
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBe(150_000);
    expect(result.current.error).toBeNull();
  });
});
