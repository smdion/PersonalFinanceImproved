/** Projection state — composes form state, data-fetching queries, and derived computations into a single hook, with override setters that also save. */
import { useCallback } from "react";
import type { AccumOverride, DecumOverride } from "./types";
import { useProjectionFormState } from "./use-projection-form-state";
import { useProjectionQueries } from "./use-projection-queries";
import { useProjectionDerived } from "./use-projection-derived";

import type { UseProjectionStateProps } from "./use-projection-state.types";

export function useProjectionState(props: UseProjectionStateProps) {
  const form = useProjectionFormState();
  const queries = useProjectionQueries(form, props);
  const derived = useProjectionDerived(form, queries, props);

  // Persistent override setters — update state AND save to DB
  const setAccumOverrides = useCallback(
    (
      updater: AccumOverride[] | ((prev: AccumOverride[]) => AccumOverride[]),
    ) => {
      form.setAccumOverrides((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next.length > 0) {
          queries.saveProjectionOverrides.mutate({
            overrideType: "accumulation",
            // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
            overrides: next as unknown as Record<string, unknown>[],
          });
        } else {
          queries.clearProjectionOverrides.mutate({
            overrideType: "accumulation",
          });
        }
        return next;
      });
    },
    [form, queries],
  );

  const setDecumOverrides = useCallback(
    (
      updater: DecumOverride[] | ((prev: DecumOverride[]) => DecumOverride[]),
    ) => {
      form.setDecumOverrides((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next.length > 0) {
          queries.saveProjectionOverrides.mutate({
            overrideType: "decumulation",
            // eslint-disable-next-line no-restricted-syntax -- Drizzle JSONB requires Record<string, unknown>[]
            overrides: next as unknown as Record<string, unknown>[],
          });
        } else {
          queries.clearProjectionOverrides.mutate({
            overrideType: "decumulation",
          });
        }
        return next;
      });
    },
    [form, queries],
  );

  return {
    // Form state (override setAccumOverrides/setDecumOverrides with persistent versions)
    ...form,
    setAccumOverrides,
    setDecumOverrides,

    // Queries + mutations
    ...queries,

    // Derived data
    ...derived,
  };
}
