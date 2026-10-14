"use client";

/**
 * Dismissed / snoozed recommendations: read by everyone (household-wide),
 * changed by admins only (the settings write is admin-gated).
 */
import { useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { SK_RECOMMENDATION_DISMISSALS } from "@/lib/constants/settings-keys";
import { localDateStr } from "@/lib/utils/date";
import { toast } from "@/lib/hooks/use-toast";
import {
  nextDismissals,
  parseDismissals,
  snoozeUntil,
  type Dismissals,
} from "@/lib/pure/recommendation-dismissals";
import type { Recommendation } from "@/lib/pure/recommendations";

/** How long "Snooze" hides a recommendation. */
const SNOOZE_MONTHS = 3;

export function useRecommendationDismissals() {
  const utils = trpc.useUtils();
  const canEdit = isAdmin(useUser());
  const { data: settings } = trpc.settings.appSettings.list.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const dismissals: Dismissals = parseDismissals(
    settings?.find((s) => s.key === SK_RECOMMENDATION_DISMISSALS)?.value,
  );
  const today = localDateStr();
  const save = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => void utils.settings.appSettings.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  // The whole map is rewritten on each change, so writes run one at a time
  // and each starts from the freshly-read saved map — a second dismiss
  // clicked before the first's refetch lands can't resurrect the first.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const write = (id: string, value: Dismissals[string] | null) => {
    queue.current = queue.current
      .then(async () => {
        const latest = await utils.settings.appSettings.list
          .fetch(undefined, { staleTime: 0 })
          .catch((e: unknown) => {
            toast.error(
              e instanceof Error ? e.message : "Couldn't load dismissals",
            );
            throw e;
          });
        const saved = parseDismissals(
          latest.find((s) => s.key === SK_RECOMMENDATION_DISMISSALS)?.value,
        );
        await save.mutateAsync({
          key: SK_RECOMMENDATION_DISMISSALS,
          value: nextDismissals(saved, today, { id, value }),
        });
      })
      .catch(() => {
        // Surfaced by the mutation's onError; keep the queue going.
      });
  };
  return {
    dismissals,
    today,
    canEdit,
    isPending: save.isPending,
    dismiss: (r: Recommendation, note: string) =>
      write(r.id, {
        until: null,
        urgency: r.urgency,
        on: today,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    snooze: (r: Recommendation, note: string) =>
      write(r.id, {
        until: snoozeUntil(today, SNOOZE_MONTHS),
        urgency: r.urgency,
        on: today,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    restore: (r: Recommendation) => write(r.id, null),
  };
}
