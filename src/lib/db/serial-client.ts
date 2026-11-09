/**
 * Wraps a pooled client so its Promise-style queries run one at a time: pg rejects a query sent
 * while another runs on the same client, and pool-style code (Promise.all) runs on demo-schema
 * clients. Parallel `db.transaction` calls still interleave BEGIN/COMMIT on the one connection.
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
