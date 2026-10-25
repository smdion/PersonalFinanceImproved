/**
 * A focus link opens a page in a state and marks a section; the page's own
 * choices take over from there (lib/config/focus-topics, RULES.md § Links
 * into Pages).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/retirement",
  useSearchParams: () => search,
}));

import {
  useFocusMatch,
  useFocusReveal,
  useFocusedState,
} from "@/lib/hooks/use-focus";

beforeEach(() => {
  replace.mockClear();
  search = new URLSearchParams();
});

describe("useFocusMatch", () => {
  it("the matching topic's ids; null for another topic", () => {
    search = new URLSearchParams("focus=projectionYear&focusId=2047");
    expect(
      renderHook(() => useFocusMatch("projectionYear")).result.current,
    ).toEqual({ year: 2047 });
    expect(
      renderHook(() => useFocusMatch("planHealth")).result.current,
    ).toBeNull();
  });

  it("a missing or stale id matches nothing", () => {
    search = new URLSearchParams("focus=projectionYear&focusId=soon");
    expect(
      renderHook(() => useFocusMatch("projectionYear")).result.current,
    ).toBeNull();
  });

  it("an unknown topic is ignored", () => {
    search = new URLSearchParams("focus=nope");
    expect(
      renderHook(() => useFocusMatch("planHealth")).result.current,
    ).toBeNull();
  });
});

describe("useFocusedState", () => {
  it("the focus sets the page's state; without one, the page's own default", () => {
    search = new URLSearchParams("focus=planHealth");
    expect(
      renderHook(() => useFocusedState("retirementTab", "projection")).result
        .current[0],
    ).toBe("planHealth");
    search = new URLSearchParams();
    expect(
      renderHook(() => useFocusedState("retirementTab", "projection")).result
        .current[0],
    ).toBe("projection");
  });

  it("a focus that doesn't set this key leaves it alone", () => {
    search = new URLSearchParams("focus=extraPaychecks");
    expect(
      renderHook(() => useFocusedState("retirementTab", "projection")).result
        .current[0],
    ).toBe("projection");
  });

  it("choosing clears the focus and keeps the choice", () => {
    search = new URLSearchParams("focus=planHealth&x=1");
    const { result } = renderHook(() =>
      useFocusedState("retirementTab", "projection"),
    );
    act(() => result.current[1]("comparison"));
    expect(replace).toHaveBeenCalledWith("/retirement?x=1", { scroll: false });
  });

  it("once the focus is cleared, the state it set stays (no snap back)", () => {
    search = new URLSearchParams("focus=extraPaychecks");
    const { result, rerender } = renderHook(() =>
      useFocusedState("savingsMasterTab", "manage"),
    );
    expect(result.current[0]).toBe("plan");
    search = new URLSearchParams();
    rerender();
    expect(result.current[0]).toBe("plan");
  });

  it("a new link on the same page applies (same-route navigation)", () => {
    const { result, rerender } = renderHook(() =>
      useFocusedState("retirementTab", "projection"),
    );
    expect(result.current[0]).toBe("projection");
    search = new URLSearchParams("focus=planHealth");
    rerender();
    expect(result.current[0]).toBe("planHealth");
  });

  it("without a focus, choosing doesn't touch the URL", () => {
    const { result } = renderHook(() =>
      useFocusedState("retirementTab", "projection"),
    );
    act(() => result.current[1]("planHealth"));
    expect(result.current[0]).toBe("planHealth");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("useFocusReveal", () => {
  it("opens when the focus arrives; the user can still close it", () => {
    const { result, rerender } = renderHook(() =>
      useFocusReveal("holdingHistory"),
    );
    expect(result.current[0]).toBe(false);
    search = new URLSearchParams("focus=holdingHistory");
    rerender();
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
