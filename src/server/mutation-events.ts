/**
 * "A mutation just succeeded" signal for server-side caches.
 *
 * trpc.ts raises it after every successful mutation; short-lived caches
 * (buildYearEndHistory's) subscribe so a write is never followed by a
 * read of data built before it. A leaf module so trpc.ts doesn't have to
 * import the helpers that own the caches.
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
