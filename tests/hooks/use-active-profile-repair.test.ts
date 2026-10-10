/**
 * Regression: the repair write must not loop when it doesn't stick. In
 * DEMO_ONLY mode (and for viewers without write permission) setActive is
 * applied optimistically and then reverted, so the stored id flips healthy →
 * broken; retrying on that fired setActive several times a second from ~20
 * dashboard components, the network never idled, and the privacy-mode E2E
 * tests timed out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useActiveProfileRepair,
  resetActiveProfileRepairsForTests,
} from "@/lib/hooks/use-active-profile-repair";

type Props = {
  activeId: number | null;
  profiles: { id: number }[] | undefined;
};

function setup(initial: Props, setActiveId = vi.fn()) {
  const hook = renderHook(
    ({ activeId, profiles }: Props) =>
      useActiveProfileRepair("contribution", activeId, profiles, setActiveId),
    { initialProps: initial },
  );
  return { ...hook, setActiveId };
}

beforeEach(() => resetActiveProfileRepairsForTests());

describe("useActiveProfileRepair", () => {
  it("points a missing id at the first profile", () => {
    const { setActiveId } = setup({
      activeId: null,
      profiles: [{ id: 3 }, { id: 4 }],
    });
    expect(setActiveId).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("does nothing when the stored id names a real profile", () => {
    const { setActiveId } = setup({
      activeId: 4,
      profiles: [{ id: 3 }, { id: 4 }],
    });
    expect(setActiveId).not.toHaveBeenCalled();
  });

  it("does not retry when an optimistic write is reverted (healthy → broken flip)", () => {
    const { rerender, setActiveId } = setup({
      activeId: null,
      profiles: [{ id: 3 }],
    });
    for (let i = 0; i < 10; i++) {
      rerender({ activeId: 3, profiles: [{ id: 3 }] }); // optimistic
      rerender({ activeId: null, profiles: [{ id: 3 }] }); // reverted after the write failed
    }
    expect(setActiveId).toHaveBeenCalledTimes(1);
  });

  it("makes one attempt across many mounted consumers", () => {
    const setActiveId = vi.fn();
    for (let i = 0; i < 20; i++)
      setup({ activeId: null, profiles: [{ id: 3 }] }, setActiveId);
    expect(setActiveId).toHaveBeenCalledTimes(1);
  });

  it("gives a different broken state its own attempt", () => {
    const { rerender, setActiveId } = setup({
      activeId: 9,
      profiles: [{ id: 3 }],
    });
    rerender({ activeId: 9, profiles: [{ id: 5 }] });
    expect(setActiveId).toHaveBeenNthCalledWith(1, 3);
    expect(setActiveId).toHaveBeenNthCalledWith(2, 5);
  });

  it("tracks each profile kind separately", () => {
    const setActiveId = vi.fn();
    renderHook(() =>
      useActiveProfileRepair("contribution", null, [{ id: 3 }], setActiveId),
    );
    renderHook(() =>
      useActiveProfileRepair("salary", null, [{ id: 3 }], setActiveId),
    );
    expect(setActiveId).toHaveBeenCalledTimes(2);
  });
});
