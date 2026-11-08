"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { LumpSumEvent } from "@/components/retirement-projection/types";

/**
 * The Brokerage page's planned events (persisted to the DB). Shows the saved
 * list until the first edit, then the local list.
 */
export function useBrokerageLumpSums() {
  const utils = trpc.useUtils();
  const brokerageLumpQuery = trpc.retirement.projectionOverrides.get.useQuery({
    overrideType: "brokerage",
  });
  const saveBrokerageLumps =
    trpc.retirement.projectionOverrides.save.useMutation({
      onSuccess: () => utils.brokerage.invalidate(),
    });
  const clearBrokerageLumps =
    trpc.retirement.projectionOverrides.clear.useMutation({
      onSuccess: () => utils.brokerage.invalidate(),
    });
  const [brokerageTouched, setBrokerageTouched] = useState(false);
  const [brokerageLumpSumsLocal, setBrokerageLumpSumsLocal] = useState<
    LumpSumEvent[]
  >([]);
  const brokerageLumpSums: LumpSumEvent[] = brokerageTouched
    ? brokerageLumpSumsLocal
    : brokerageLumpQuery.data && brokerageLumpQuery.data.length > 0
      ? (brokerageLumpQuery.data as LumpSumEvent[])
      : brokerageLumpSumsLocal;
  const setBrokerageLumpSums = (
    updater: LumpSumEvent[] | ((prev: LumpSumEvent[]) => LumpSumEvent[]),
  ) => {
    // Built from the list on screen (saved events until the first edit), and
    // outside any state updater so the save runs once, not twice in StrictMode.
    const next =
      typeof updater === "function" ? updater(brokerageLumpSums) : updater;
    setBrokerageTouched(true);
    setBrokerageLumpSumsLocal(next);
    if (next.length > 0) {
      saveBrokerageLumps.mutate({
        overrideType: "brokerage",
        // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
        overrides: next as unknown as Record<string, unknown>[],
      });
    } else {
      clearBrokerageLumps.mutate({ overrideType: "brokerage" });
    }
  };
  return { brokerageLumpSums, setBrokerageLumpSums };
}
