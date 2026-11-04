/* eslint-disable no-restricted-syntax -- partial fixtures cast to Drizzle row types */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import type { LumpSumEvent } from "@/components/cards/projection/types";

import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setQuery,
} from "../components/trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

const SAVE = "retirement.projectionOverrides.save";
const CLEAR = "retirement.projectionOverrides.clear";
const saves = () => mutationCalls(SAVE) as { overrides: LumpSumEvent[] }[];
const saved = (events: LumpSumEvent[]) =>
  setQuery("retirement.projectionOverrides.get", events);

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
    resetTrpcMock();
    // Neither settles: these tests read the calls, not what follows them.
    holdMutation(SAVE);
    holdMutation(CLEAR);
    saved([ev("a"), ev("b")]);
  });

  it("keeps the saved events when the first edit adds one", () => {
    const { result } = renderHook(() => useBrokerageLumpSums(), { wrapper });
    act(() => result.current.setBrokerageLumpSums((p) => [...p, ev("c")]));
    expect(saves()).toHaveLength(1);
    expect(saves()[0]!.overrides.map((o) => o.id)).toEqual(["a", "b", "c"]);
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
    expect(mutationCalls(CLEAR)).toHaveLength(0);
    expect(saves()).toHaveLength(1);
    expect(saves()[0]!.overrides.map((o) => o.id)).toEqual(["b"]);
  });

  it("clears only when the last event is deleted, and mutates once", () => {
    saved([ev("a")]);
    const { result } = renderHook(() => useBrokerageLumpSums(), { wrapper });
    act(() =>
      result.current.setBrokerageLumpSums((p) => p.filter((x) => x.id !== "a")),
    );
    expect(mutationCalls(CLEAR)).toHaveLength(1);
    expect(saves()).toHaveLength(0);
  });
});
