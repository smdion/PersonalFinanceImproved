/* eslint-disable no-restricted-syntax -- partial fixtures cast to Drizzle row types */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import type { LumpSumEvent } from "@/components/cards/projection/types";

const save = vi.fn();
const clear = vi.fn();
let saved: LumpSumEvent[] | undefined;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ brokerage: { invalidate: vi.fn() } }),
    retirement: {
      projectionOverrides: {
        get: { useQuery: () => ({ data: saved }) },
        save: { useMutation: () => ({ mutate: save }) },
        clear: { useMutation: () => ({ mutate: clear }) },
      },
    },
  },
}));

import { useBrokerageLumpSums } from "@/app/(dashboard)/brokerage/use-brokerage-lump-sums";

const ev = (id: string): LumpSumEvent =>
  ({
    id,
    label: id,
    year: "2030",
    amount: "1000",
  }) as unknown as LumpSumEvent;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(StrictMode, null, children);

describe("useBrokerageLumpSums", () => {
  beforeEach(() => {
    save.mockReset();
    clear.mockReset();
    saved = [ev("a"), ev("b")];
  });

  it("keeps the saved events when the first edit adds one", () => {
    const { result } = renderHook(() => useBrokerageLumpSums(), { wrapper });
    act(() => result.current.setBrokerageLumpSums((p) => [...p, ev("c")]));
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      save.mock.calls[0]![0].overrides.map((o: LumpSumEvent) => o.id),
    ).toEqual(["a", "b", "c"]);
    expect(result.current.brokerageLumpSums.map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("deletes only the one event on the first edit, never clearing the rest", () => {
    const { result } = renderHook(() => useBrokerageLumpSums(), { wrapper });
    act(() =>
      result.current.setBrokerageLumpSums((p) => p.filter((x) => x.id !== "a")),
    );
    expect(clear).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      save.mock.calls[0]![0].overrides.map((o: LumpSumEvent) => o.id),
    ).toEqual(["b"]);
  });

  it("clears only when the last event is deleted, and mutates once", () => {
    saved = [ev("a")];
    const { result } = renderHook(() => useBrokerageLumpSums(), { wrapper });
    act(() =>
      result.current.setBrokerageLumpSums((p) => p.filter((x) => x.id !== "a")),
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
