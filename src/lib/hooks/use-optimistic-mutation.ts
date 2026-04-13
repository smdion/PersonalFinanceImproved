"use client";

/**
 * useOptimisticMutation — wraps a tRPC mutation with optimistic update +
 * automatic rollback on error.
 *
 * Closes the v0.5 expert-review M27 finding: scenario overrides + retirement
 * settings round-trip to DB before the UI updates. This hook gives mutation
 * call sites a one-line upgrade path:
 *
 *   // Before
 *   const m = trpc.budget.updateItem.useMutation();
 *   m.mutate({ id, value });
 *
 *   // After
 *   const m = useOptimisticMutation(
 *     trpc.budget.updateItem.useMutation(),
 *     {
 *       optimisticUpdate: (input) => {
 *         const prev = utils.budget.list.getData();
 *         utils.budget.list.setData(undefined, (p) => updateById(p, input));
 *         return prev;
 *       },
 *       rollback: (previousData) => {
 *         utils.budget.list.setData(undefined, previousData);
 *       },
 *     },
 *   );
 *   m.mutate({ id, value });
 *
 * The hook is a thin wrapper around any object exposing
 * { mutate(input, opts?), isPending } — works with tRPC's useMutation
 * return value, manual fetch wrappers, etc.
 *
 * Undo-toast support is a separate feature (requires extending the Toast
 * API with action buttons). Tracked as a v0.5.x follow-up.
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "@/lib/hooks/use-toast";

interface OptimisticMutationOptions<TInput, TPrevious> {
  /**
   * Apply the change to local cache before the mutation fires.
   * Return the previous state so the rollback can restore it.
   */
  optimisticUpdate: (input: TInput) => TPrevious;
  /**
   * Restore the previous state on error.
   */
  rollback: (previousData: TPrevious) => void;
  /**
   * Optional callback after the mutation settles (success OR error).
   */
  onSettled?: () => void;
  /**
   * If true (default), shows a generic "Save failed — change rolled back"
   * toast on error. Set to false if the call site renders its own error UI.
   */
  showErrorToast?: boolean;
  /**
   * Optional undo affordance shown as a toast.undo() after a successful
   * mutation. undoFn receives the original input and should issue the
   * inverse mutation (e.g., re-create what was deleted, restore previous
   * value). v0.5 expert-review M27.
   */
  undo?: {
    /** Toast body, e.g., "Removed item" or "Deleted scenario". */
    label: string;
    /** Called when the user clicks Undo within the window. */
    undoFn: (input: TInput) => void;
    /** Window before the toast auto-dismisses (default 5000ms). */
    windowMs?: number;
  };
}

interface GenericMutation<TInput, TOutput> {
  mutate: (
    input: TInput,
    opts?: {
      onSuccess?: (data: TOutput) => void;
      onError?: (error: unknown) => void;
      onSettled?: () => void;
    },
  ) => void;
  isPending: boolean;
}

interface UseOptimisticMutationReturn<TInput> {
  mutate: (input: TInput) => void;
  isPending: boolean;
  /** True if the most recent mutation failed and was rolled back. */
  hasRolledBack: boolean;
}

export function useOptimisticMutation<TInput, TOutput, TPrevious>(
  mutation: GenericMutation<TInput, TOutput>,
  options: OptimisticMutationOptions<TInput, TPrevious>,
): UseOptimisticMutationReturn<TInput> {
  const [hasRolledBack, setHasRolledBack] = useState(false);
  // Track the previous data per in-flight mutation so rapid clicks don't
  // clobber each other. Map keyed by call ordinal.
  const inflightRef = useRef(new Map<number, TPrevious>());
  const callOrdinalRef = useRef(0);
  const showErrorToast = options.showErrorToast ?? true;

  const mutate = useCallback(
    (input: TInput) => {
      const ordinal = ++callOrdinalRef.current;
      // Optimistically apply, capture previous state.
      const previous = options.optimisticUpdate(input);
      inflightRef.current.set(ordinal, previous);
      setHasRolledBack(false);

      mutation.mutate(input, {
        onSuccess: () => {
          if (options.undo) {
            const u = options.undo;
            toast.undo(u.label, () => u.undoFn(input), u.windowMs ?? 5000);
          }
        },
        onError: () => {
          const prev = inflightRef.current.get(ordinal);
          if (prev !== undefined) {
            options.rollback(prev);
            setHasRolledBack(true);
          }
          if (showErrorToast) {
            toast.error("Save failed — your change has been rolled back.");
          }
        },
        onSettled: () => {
          inflightRef.current.delete(ordinal);
          options.onSettled?.();
        },
      });
    },
    [mutation, options, showErrorToast],
  );

  return {
    mutate,
    isPending: mutation.isPending,
    hasRolledBack,
  };
}
