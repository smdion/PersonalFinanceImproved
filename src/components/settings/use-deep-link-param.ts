"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useClearParams } from "@/lib/hooks/use-focus";

const NONE: readonly string[] = [];

/**
 * A persisted tab/section choice a link can open (`?tab=integrations&section=simplefin`). A valid
 * param wins for display only and is never saved (viewers may lack permission); choosing a
 * tab/section clears the param and saves as usual.
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
