import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBoundedPollInterval } from "@/lib/hooks/use-bounded-poll-interval";

describe("useBoundedPollInterval", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns the base interval while under maxPolls, called with enabled=true", () => {
    const { result } = renderHook(() =>
      useBoundedPollInterval(400, 3, true, "test"),
    );
    // Each invocation of the returned callback simulates one scheduled
    // TanStack Query refetchInterval check.
    expect(result.current()).toBe(400);
    expect(result.current()).toBe(400);
    expect(result.current()).toBe(400);
  });

  it("returns false and warns once after exceeding maxPolls", () => {
    const { result } = renderHook(() =>
      useBoundedPollInterval(400, 2, true, "test-trip"),
    );
    expect(result.current()).toBe(400); // poll 1
    expect(result.current()).toBe(400); // poll 2
    expect(result.current()).toBe(false); // poll 3 -- exceeds maxPolls=2
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("test-trip");
  });

  it("stays tripped (keeps returning false) after the ceiling is crossed, without warning again", () => {
    const { result } = renderHook(() =>
      useBoundedPollInterval(400, 1, true, "test-stay-tripped"),
    );
    expect(result.current()).toBe(400);
    expect(result.current()).toBe(false);
    expect(result.current()).toBe(false);
    expect(result.current()).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("resets the poll count and trip state when enabled transitions back to true (a fresh run gets a full budget)", () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useBoundedPollInterval(400, 1, enabled, "test-reset"),
      { initialProps: { enabled: true } },
    );
    expect(result.current()).toBe(400);
    expect(result.current()).toBe(false); // tripped
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A real run finishing (enabled -> false) then a new one starting
    // (enabled -> true) must not still be tripped from the old run.
    rerender({ enabled: false });
    rerender({ enabled: true });

    expect(result.current()).toBe(400);
    expect(result.current()).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("never trips while enabled stays false (nothing to poll, so the ceiling is irrelevant)", () => {
    renderHook(() => useBoundedPollInterval(400, 1, false, "test-disabled"));
    // Callers gate the actual polling on `enabled` themselves via
    // useQuery's own `enabled` option; this hook's callback isn't invoked
    // by TanStack in that case, but confirm it doesn't warn just from
    // being constructed disabled.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
