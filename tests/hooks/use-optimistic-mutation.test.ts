/**
 * T1 — src/lib/hooks/ had zero unit tests for any hook. This covers
 * useOptimisticMutation's rollback behavior: the hook applies an optimistic
 * update immediately, then either leaves it in place (success) or calls
 * rollback() with the captured previous state (error) — plus the
 * rapid-fire-clicks case where overlapping in-flight mutations must not
 * clobber each other's rollback state.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptimisticMutation } from "@/lib/hooks/use-optimistic-mutation";

vi.mock("@/lib/hooks/use-toast", () => ({
  toast: {
    error: vi.fn(),
    undo: vi.fn(),
  },
}));

type MutateOpts<TOutput> = {
  onSuccess?: (data: TOutput) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

/** A controllable fake mutation — resolve/reject is driven by the test. */
function makeFakeMutation<TInput, TOutput>() {
  const calls: { input: TInput; opts?: MutateOpts<TOutput> }[] = [];
  const mutation = {
    mutate: vi.fn((input: TInput, opts?: MutateOpts<TOutput>) => {
      calls.push({ input, opts });
    }),
    isPending: false,
  };
  return { mutation, calls };
}

describe("useOptimisticMutation", () => {
  it("applies the optimistic update immediately on mutate()", () => {
    const { mutation } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });

    expect(optimisticUpdate).toHaveBeenCalledWith({ id: 1 });
    expect(mutation.mutate).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    );
    expect(result.current.hasRolledBack).toBe(false);
  });

  it("rolls back to the captured previous state on error", () => {
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });

    // Simulate the mutation failing.
    act(() => {
      calls[0]!.opts!.onError!(new Error("boom"));
    });

    expect(rollback).toHaveBeenCalledWith("previous-state");
    expect(result.current.hasRolledBack).toBe(true);
  });

  it("does not roll back on success", () => {
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });
    act(() => {
      calls[0]!.opts!.onSuccess!(undefined);
      calls[0]!.opts!.onSettled!();
    });

    expect(rollback).not.toHaveBeenCalled();
    expect(result.current.hasRolledBack).toBe(false);
  });

  it("does not let an earlier in-flight mutation's onSettled clear a still-pending later mutation's guard", () => {
    // This exercises the per-call-ordinal tracking (inflightRef / callOrdinalRef):
    // two rapid mutate() calls, first one's onError fires AFTER the second's
    // onSuccess/onSettled already ran. The first mutation's rollback must
    // still use ITS OWN captured previous state, not the second's.
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const previousStates = ["state-A", "state-B"];
    let call = 0;
    const optimisticUpdate = vi.fn(() => previousStates[call++]);
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 }); // call ordinal 1, captures state-A
      result.current.mutate({ id: 2 }); // call ordinal 2, captures state-B
    });

    // Second call settles first (success).
    act(() => {
      calls[1]!.opts!.onSuccess!(undefined);
      calls[1]!.opts!.onSettled!();
    });

    // First call then errors — should roll back to ITS OWN previous state.
    act(() => {
      calls[0]!.opts!.onError!(new Error("boom"));
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith("state-A");
  });

  it("fires the undo toast on success when undo is configured", async () => {
    const { toast } = await import("@/lib/hooks/use-toast");
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();
    const undoFn = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, {
        optimisticUpdate,
        rollback,
        undo: { label: "Removed item", undoFn },
      }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });
    act(() => {
      calls[0]!.opts!.onSuccess!(undefined);
    });

    expect(toast.undo).toHaveBeenCalledWith(
      "Removed item",
      expect.any(Function),
      5000,
    );
  });

  it("shows the generic error toast on failure by default", async () => {
    const { toast } = await import("@/lib/hooks/use-toast");
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });
    act(() => {
      calls[0]!.opts!.onError!(new Error("boom"));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Save failed — your change has been rolled back.",
    );
  });

  it("suppresses the error toast when showErrorToast is false", async () => {
    const { toast } = await import("@/lib/hooks/use-toast");
    vi.mocked(toast.error).mockClear();
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, {
        optimisticUpdate,
        rollback,
        showErrorToast: false,
      }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });
    act(() => {
      calls[0]!.opts!.onError!(new Error("boom"));
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalled();
  });

  it("awaits an async optimisticUpdate before firing the mutation", async () => {
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    let resolveUpdate!: (v: string) => void;
    const optimisticUpdate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, { optimisticUpdate, rollback }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });

    // The mutation must not fire until optimisticUpdate resolves.
    expect(mutation.mutate).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpdate("previous-state");
      await Promise.resolve();
    });

    expect(mutation.mutate).toHaveBeenCalledWith({ id: 1 }, expect.anything());

    act(() => {
      calls[0]!.opts!.onError!(new Error("boom"));
    });
    expect(rollback).toHaveBeenCalledWith("previous-state");
  });

  it("calls onSettled after success and after a rolled-back error", () => {
    const { mutation, calls } = makeFakeMutation<{ id: number }, unknown>();
    const optimisticUpdate = vi.fn().mockReturnValue("previous-state");
    const rollback = vi.fn();
    const onSettled = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticMutation(mutation, {
        optimisticUpdate,
        rollback,
        onSettled,
      }),
    );

    act(() => {
      result.current.mutate({ id: 1 });
    });
    act(() => {
      calls[0]!.opts!.onSuccess!(undefined);
      calls[0]!.opts!.onSettled!();
    });
    expect(onSettled).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.mutate({ id: 2 });
    });
    act(() => {
      calls[1]!.opts!.onError!(new Error("boom"));
      calls[1]!.opts!.onSettled!();
    });
    expect(onSettled).toHaveBeenCalledTimes(2);
  });
});
