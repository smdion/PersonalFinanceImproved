"use client";

import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { toProfileId } from "@/lib/pure/household/retirement-profile";

/** A profile-id setting read however it was stored (a number, or the
 *  numeric string an older PostgreSQL write left); null when unset or not an
 *  id, so `p.id === id` holds for either form. */
export function useProfileIdSetting(
  key: string,
  options?: { writeVia?: (value: number | null) => Promise<unknown> },
): [number | null, (value: number | null) => void, boolean] {
  const [value, setValue, loaded] = usePersistedSetting<number | null>(
    key,
    null,
    options,
  );
  return [toProfileId(value), setValue, loaded];
}
