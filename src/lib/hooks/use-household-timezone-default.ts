"use client";

/**
 * Fills in the household time zone from an admin's browser the first time
 * the app opens without one, so server date math (year-end snapshots,
 * paycheck and budget materializers, syncs) runs on the household's days
 * instead of UTC. Once set, it only changes in Settings → General →
 * Household. Silent on failure (demo / read-only): the server keeps its
 * container zone. A browser on UTC doesn't fill it (see below).
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { SK_HOUSEHOLD_TIMEZONE } from "@/lib/constants/settings-keys";

export function useHouseholdTimeZoneDefault(): void {
  const admin = isAdmin(useUser());
  const { data: settings } = trpc.settings.appSettings.list.useQuery(
    undefined,
    { staleTime: 60_000, enabled: admin },
  );
  const upsert = trpc.settings.appSettings.upsert.useMutation();
  const tried = useRef(false);
  useEffect(() => {
    if (!admin || !settings || tried.current) return;
    if (settings.some((s) => s.key === SK_HOUSEHOLD_TIMEZONE)) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // A UTC browser is usually a headless or server one (screenshots, CI),
    // and unset already means UTC — leave it for a real browser to fill.
    if (!zone || zone === "UTC" || zone === "Etc/UTC") return;
    tried.current = true;
    upsert.mutate({ key: SK_HOUSEHOLD_TIMEZONE, value: zone });
  }, [admin, settings, upsert]);
}
