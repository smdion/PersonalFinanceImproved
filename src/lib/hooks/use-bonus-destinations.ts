"use client";

/**
 * Where each person's bonus goes (budget vs extra spending) — read by
 * everyone, changed by admins (the settings write is admin-gated). Writes
 * start from the freshly-read saved map, so changing one person never
 * drops another's choice.
 */
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { SK_BONUS_DESTINATIONS } from "@/lib/constants/settings-keys";
import { toast } from "@/lib/hooks/use-toast";
import {
  parseBonusDestinations,
  type BonusDestinations,
} from "@/lib/pure/household-income";

export function useBonusDestinations() {
  const utils = trpc.useUtils();
  const canEdit = isAdmin(useUser());
  const { data: settings } = trpc.settings.appSettings.list.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const destinations = parseBonusDestinations(
    settings?.find((s) => s.key === SK_BONUS_DESTINATIONS)?.value,
  );
  const save = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => void utils.settings.appSettings.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const setDestination = async (
    personId: number,
    destination: BonusDestinations[string],
  ) => {
    const latest = await utils.settings.appSettings.list.fetch(undefined, {
      staleTime: 0,
    });
    const saved = parseBonusDestinations(
      latest.find((s) => s.key === SK_BONUS_DESTINATIONS)?.value,
    );
    await save.mutateAsync({
      key: SK_BONUS_DESTINATIONS,
      value: { ...saved, [String(personId)]: destination },
    });
  };
  return {
    destinations,
    canEdit,
    saving: save.isPending,
    setDestination,
  };
}
