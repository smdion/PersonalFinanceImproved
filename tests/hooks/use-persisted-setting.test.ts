/**
 * T1 — usePersistedSetting's pendingWrite guard (M42,
 * .scratch/docs/review-findings.md): a per-write generation counter must
 * ensure an OLDER write settling late doesn't clear the guard while a
 * NEWER write is still pending, which would let a stale DB-echoed value
 * briefly clobber the user's latest input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";

const listQuery = vi.fn();
const upsertMutate = vi.fn();
let upsertOnSuccess: (() => void) | undefined;
const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { appSettings: { list: { invalidate } } },
    }),
    settings: {
      appSettings: {
        list: { useQuery: () => listQuery() },
        upsert: {
          useMutation: (opts?: { onSuccess?: () => void }) => {
            upsertOnSuccess = opts?.onSuccess;
            return { mutate: upsertMutate };
          },
        },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listQuery.mockReturnValue({ data: undefined });
});

describe("usePersistedSetting", () => {
  it("seeds from localStorage before the query resolves", () => {
    localStorage.setItem("setting:my_key", JSON.stringify("stored-value"));

    const { result } = renderHook(() =>
      usePersistedSetting("my_key", "default-value"),
    );

    expect(result.current[0]).toBe("stored-value");
  });

  /**
   * Regression test for a real hydration-mismatch bug: reading localStorage
   * inside the useState lazy initializer meant the value returned differed
   * between SSR (no window, always defaultValue) and the client's very
   * first synchronous render (window present, reads localStorage
   * immediately) — a same-render server/client branch. The initial
   * synchronous state produced by the hook (before React flushes any
   * effects) must always be defaultValue, regardless of what's in
   * localStorage; the stored value may only arrive via an effect, i.e.
   * after the render React would have used to reconcile against SSR HTML.
   */
  it("returns defaultValue synchronously before effects flush, even when localStorage has a stored value", () => {
    localStorage.setItem("setting:my_key", JSON.stringify("stored-value"));

    let syncValue: string | undefined;
    function useProbe() {
      const [value] = usePersistedSetting("my_key", "default-value");
      // Capture the FIRST render's value before any subsequent re-render
      // (triggered by the mount effect's setState) can overwrite it.
      if (syncValue === undefined) syncValue = value;
      return value;
    }

    renderHook(() => useProbe());

    expect(syncValue).toBe("default-value");
  });

  it("falls back to defaultValue when nothing is in localStorage", () => {
    const { result } = renderHook(() =>
      usePersistedSetting("unset_key", "default-value"),
    );

    expect(result.current[0]).toBe("default-value");
  });

  it("adopts the DB value once the query resolves", () => {
    listQuery.mockReturnValue({
      data: [{ key: "my_key", value: "db-value" }],
    });

    const { result } = renderHook(() =>
      usePersistedSetting("my_key", "default-value"),
    );

    expect(result.current[0]).toBe("db-value");
  });

  it("optimistically updates local state and fires the mutation on setValue", () => {
    const { result } = renderHook(() =>
      usePersistedSetting("my_key", "default-value"),
    );

    act(() => {
      result.current[1]("new-value");
    });

    expect(result.current[0]).toBe("new-value");
    expect(localStorage.getItem("setting:my_key")).toBe(
      JSON.stringify("new-value"),
    );
    expect(upsertMutate).toHaveBeenCalledWith(
      { key: "my_key", value: "new-value" },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("does not let a late-settling OLDER write's onSettled clear the guard while a NEWER write is pending (M42)", () => {
    const { result, rerender } = renderHook(
      ({ dbValue }: { dbValue: string | undefined }) => {
        listQuery.mockReturnValue(
          dbValue !== undefined
            ? { data: [{ key: "my_key", value: dbValue }] }
            : { data: undefined },
        );
        return usePersistedSetting("my_key", "default-value");
      },
      { initialProps: { dbValue: undefined as string | undefined } },
    );

    const settledCallbacks: (() => void)[] = [];
    upsertMutate.mockImplementation(
      (_input: unknown, opts: { onSettled: () => void }) => {
        settledCallbacks.push(opts.onSettled);
      },
    );

    // Two rapid writes — user types "A" then "B".
    act(() => {
      result.current[1]("A");
    });
    act(() => {
      result.current[1]("B");
    });

    expect(result.current[0]).toBe("B");

    // The OLDER write (A) settles late, after B already started.
    act(() => {
      settledCallbacks[0]!();
    });

    // A stale DB refetch echoing back the pre-B value must NOT clobber "B",
    // because the guard should still be up (B's write hasn't settled yet).
    act(() => {
      rerender({ dbValue: "A" });
    });
    expect(result.current[0]).toBe("B");

    // Once the NEWER write (B) itself settles, the guard clears and a
    // DB-confirmed value can flow through again.
    act(() => {
      settledCallbacks[1]!();
    });
    act(() => {
      rerender({ dbValue: "B" });
    });
    expect(result.current[0]).toBe("B");
  });

  it("invalidates the settings list query on successful upsert", () => {
    renderHook(() => usePersistedSetting("my_key", "default-value"));

    act(() => {
      upsertOnSuccess?.();
    });

    expect(invalidate).toHaveBeenCalled();
  });
});
