/**
 * A pooled client that runs one query at a time. A drizzle instance bound to
 * one client (demo schemas set search_path on a dedicated connection) serves
 * code written for the pool, which runs independent reads with Promise.all.
 * pg rejects a query sent while another is running on the same client (an
 * error from pg@9), so each query here starts once the previous one settles.
 * Promise-style `query` calls only (what drizzle uses).
 *
 * Parallel `db.transaction` calls on one client still interleave their
 * BEGIN/COMMIT on the one connection, as they would on the bare client.
 */
export function serializeQueries<
  T extends { query(...args: never[]): unknown },
>(
  client: T,
): {
  client: T;
  /** Refuses new queries and resolves once the queued ones settle; await it
   *  before resetting or releasing the client. */
  close(): Promise<void>;
} {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const query = (...args: unknown[]): Promise<unknown> => {
    if (closed)
      return Promise.reject(new Error("Query sent after its client closed"));
    const run = tail.then(() => Reflect.apply(client.query, client, args));
    tail = run.catch(() => undefined);
    return run;
  };
  return {
    client: new Proxy(client, {
      get: (target, prop) =>
        prop === "query" ? query : Reflect.get(target, prop, target),
    }),
    close: async () => {
      closed = true;
      await tail;
    },
  };
}
