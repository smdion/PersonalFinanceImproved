"use client";

/**
 * Dismissed / snoozed recommendations: read by everyone (household-wide),
 * changed by admins only (the settings write is admin-gated).
 */
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
  const write = (id: string, value: Dismissals[string] | null) =>
    save.mutate({
      key: SK_RECOMMENDATION_DISMISSALS,
      value: nextDismissals(dismissals, today, { id, value }),
    });
  return {
    dismissals,
    today,
    canEdit,
    isPending: save.isPending,
    dismiss: (r: Recommendation) =>
      write(r.id, { until: null, urgency: r.urgency }),
    snooze: (r: Recommendation) =>
      write(r.id, {
        until: snoozeUntil(today, SNOOZE_MONTHS),
        urgency: r.urgency,
      }),
    restore: (r: Recommendation) => write(r.id, null),
  };
}
