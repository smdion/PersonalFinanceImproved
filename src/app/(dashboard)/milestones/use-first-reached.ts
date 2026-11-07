"use client";

/**
 * When each milestone was first reached. Opening the Milestones page asks
 * the server to record any newly reached ones (it judges them itself, on
 * the active profiles), once per visit.
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { localDateStr } from "@/lib/utils/date";
import { isNewlyReached } from "@/lib/pure/advice/milestone-first-reached";

export function useFirstReached(): (
  id: string,
) => { date: string; isNew: boolean } | null {
  const utils = trpc.useUtils();
  const { data } = trpc.milestones.firstReached.useQuery();
  const record = trpc.milestones.recordReached.useMutation({
    onSuccess: (next) => {
      if (next) utils.milestones.firstReached.setData(undefined, next);
    },
  });
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    record.mutate();
  }, [record]);
  const today = localDateStr();
  return (id) => {
    const date = data?.reached[id];
    // Only a full date: a year comes from the history (the note already
    // says it) and "" was reached before recording began.
    if (!date || date.length !== 10) return null;
    return { date, isNew: isNewlyReached(data, id, today) };
  };
}
