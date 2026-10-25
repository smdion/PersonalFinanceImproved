"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useClearParams } from "./use-focus";

const NONE: readonly string[] = [];

/**
 * A persisted tab/section choice that a link can open directly
 * (`/settings?tab=integrations&section=simplefin`).
 *
 * A valid `?param=` value wins for display only — following a link never
 * writes the persisted setting (a viewer without settings permission would
 * otherwise get a failed save). Choosing a tab/section clears the param from
 * the URL and saves the choice as usual.
 */
export function useDeepLinkParam<T extends string>(
  param: string,
  validKeys: readonly string[],
  [persisted, setPersisted]: readonly [T, (value: T) => void, ...unknown[]],
  /** Other params that only make sense with this one (a tab's section). */
  clearAlso: readonly string[] = NONE,
): [T, (value: T) => void] {
  const searchParams = useSearchParams();
  const clearParams = useClearParams();
  const fromUrl = searchParams.get(param);
  const linked =
    fromUrl !== null && validKeys.includes(fromUrl) ? (fromUrl as T) : null;

  const set = useCallback(
    (value: T) => {
      clearParams([param, ...clearAlso]);
      setPersisted(value);
    },
    [param, clearAlso, clearParams, setPersisted],
  );

  return [linked ?? persisted, set];
}
