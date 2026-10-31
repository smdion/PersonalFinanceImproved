/**
 * The high-income line is never shown wrong or stuck: undefined until the
 * saved setting has loaded (the default arriving first isn't the line when
 * one is saved), and `error` when the default fails with nothing saved —
 * callers gate on `threshold === undefined`, so without it they'd show a
 * skeleton for good.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";

const persisted = vi.fn();
const lineQuery = vi.fn();

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: () => persisted(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    contribution: { highIncomeLine: { useQuery: () => lineQuery() } },
  },
}));

const DEFAULT = { data: { threshold: 200_000, basis: "MFJ" }, error: null };

beforeEach(() => {
  persisted.mockReset();
  lineQuery.mockReset();
});

describe("useHighIncomeLine", () => {
  it("waits for the saved setting even when the default has arrived", () => {
    persisted.mockReturnValue([null, vi.fn(), false]);
    lineQuery.mockReturnValue(DEFAULT);
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBeUndefined();
    expect(result.current.error).toBe(false);
  });

  it("uses the saved line once loaded, else the default", () => {
    lineQuery.mockReturnValue(DEFAULT);
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
    lineQuery.mockReturnValue({ data: undefined, error: new Error("down") });
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBeUndefined();
    expect(result.current.error).toBe(true);
  });

  it("a saved line doesn't need the default: its failure isn't an error", () => {
    persisted.mockReturnValue([150_000, vi.fn(), true]);
    lineQuery.mockReturnValue({ data: undefined, error: new Error("down") });
    const { result } = renderHook(() => useHighIncomeLine());
    expect(result.current.threshold).toBe(150_000);
    expect(result.current.error).toBe(false);
  });
});
