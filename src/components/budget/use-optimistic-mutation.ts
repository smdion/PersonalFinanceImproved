"use client";

/**
 * Wraps a mutation ({ mutate, isPending }) with an optimistic cache update and rollback on error.
 * Errors surface through the app-wide mutation-error toast; `undo` adds an Undo toast on success.
 */

import { useCallback, useRef } from "react";
import { toast } from "@/lib/hooks/use-toast";

interface OptimisticMutationOptions<TInput, TPrevious> {
  /**
   * Apply the change to local cache and return the previous state for rollback.
   * May be async (e.g. await a query cancel); the mutation fires once it resolves.
   */
  optimisticUpdate: (input: TInput) => TPrevious | Promise<TPrevious>;
  /**
   * Restore the previous state on error.
   */
  rollback: (previousData: TPrevious) => void;
  /**
   * Called when the mutation settles (success or error), after any
   * rollback. Typical use: invalidate queries to reconcile with the server.
   */
  onSettled?: () => void;
  /**
   * Optional Undo toast after a successful mutation; undoFn receives the
   * original input and should issue the inverse mutation.
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
}

export function useOptimisticMutation<TInput, TOutput, TPrevious>(
  mutation: GenericMutation<TInput, TOutput>,
  options: OptimisticMutationOptions<TInput, TPrevious>,
): UseOptimisticMutationReturn<TInput> {
  // Track the previous data per in-flight mutation so rapid clicks don't
  // clobber each other. Map keyed by call ordinal.
  const inflightRef = useRef(new Map<number, TPrevious>());
  const callOrdinalRef = useRef(0);

  const mutate = useCallback(
    (input: TInput) => {
      const ordinal = ++callOrdinalRef.current;

      // Apply optimistically and capture previous state. An async update delays
      // the mutation until it resolves; a sync one fires it in the same tick.
      const proceed = (previous: TPrevious) => {
        inflightRef.current.set(ordinal, previous);

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
            }
            // The failure toast is the app-wide MutationCache.onError's job.
          },
          onSettled: () => {
            inflightRef.current.delete(ordinal);
            options.onSettled?.();
          },
        });
      };

      const result = options.optimisticUpdate(input);
      if (result instanceof Promise) {
        void result.then(proceed);
      } else {
        proceed(result);
      }
    },
    [mutation, options],
  );

  return {
    mutate,
    isPending: mutation.isPending,
  };
}
