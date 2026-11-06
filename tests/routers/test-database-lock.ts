/**
 * One test file at a time on the PostgreSQL test database. The suites
 * empty and rebuild that database, so a file holds this session-level
 * advisory lock from its first hook to its last (setup-postgres.ts takes
 * it), and files that vitest runs in parallel wait their turn.
 */
/** The lock's two-int key: an arbitrary pair no app lock uses (the app
 *  takes only transaction-level advisory locks, released at commit). */
export const TEST_DATABASE_LOCK = [0x4c454447, 0x74657374] as const;

/** How long a file waits for the files ahead of it, in ms. */
export const TEST_DATABASE_LOCK_WAIT_MS = 600_000;

/** The client that will hold the lock, unconnected: a `pg.Client`. */
export interface LockClient {
  connect(): Promise<unknown>;
  query(sql: string, params: number[]): Promise<unknown>;
  end(): Promise<unknown>;
}

/** Connects `client` and blocks until it holds the lock; the lock lasts
 *  until `releaseTestDatabase` (or until the connection drops). */
export async function lockTestDatabase(client: LockClient): Promise<void> {
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      ...TEST_DATABASE_LOCK,
    ]);
  } catch (err) {
    await client.end();
    throw err;
  }
}

/** Releases the lock and closes its connection, which would release it
 *  too: the explicit unlock lets the next file start before the socket
 *  closes. */
export async function releaseTestDatabase(client: LockClient): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [
      ...TEST_DATABASE_LOCK,
    ]);
  } finally {
    await client.end();
  }
}
