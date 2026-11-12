"use client";

import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { storedInteger } from "@/lib/utils/stored-integer";

type Write<T> = { writeVia?: (value: T) => Promise<unknown> };

/** An integer setting (a profile id, a budget column, a snapshot id) read
 *  however it was stored (storedInteger): a stored "1" reads as 1; `unset`
 *  (null when not given) when absent or not an integer. */
export function useIntegerSetting(
  key: string,
  unset?: null,
  options?: Write<number | null>,
): [number | null, (value: number | null) => void, boolean];
export function useIntegerSetting(
  key: string,
  unset: number,
): [number, (value: number) => void, boolean];
export function useIntegerSetting(
  key: string,
  unset: number | null = null,
  options?: Write<number | null>,
): [number | null, (value: number) => void, boolean] {
  const [value, setValue, loaded] = usePersistedSetting<number | null>(
    key,
    unset,
    options,
  );
  return [storedInteger(value, unset), setValue, loaded];
}

/** A profile-id setting: an integer setting, null when unset, so
 *  `p.id === id` holds for either stored form. */
export function useProfileIdSetting(
  key: string,
  options?: Write<number | null>,
): [number | null, (value: number | null) => void, boolean] {
  return useIntegerSetting(key, null, options);
}
