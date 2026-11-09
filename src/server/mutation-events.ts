/**
 * "A mutation just succeeded" signal, raised by trpc.ts, so short-lived server caches
 * never serve data built before a write. A leaf module to keep trpc.ts's imports light.
 */
const listeners = new Set<() => void>();

/** Run `listener` after every successful tRPC mutation. */
export function onMutationSucceeded(listener: () => void): void {
  listeners.add(listener);
}

/** Called by trpc.ts once a mutation has succeeded. */
export function notifyMutationSucceeded(): void {
  for (const listener of listeners) listener();
}
