import type { DbOrTx } from "@/lib/db";
import type { Permission } from "@/lib/config/permissions";
import { calendarDateOf, type CalendarDate } from "@/lib/utils/calendar-date";

/** A read of the db alone: a module-level loader such as getAllPeople. */
type DbRead<T> = (db: DbOrTx) => PromiseLike<T>;

/** What one tRPC procedure call reads against: its db (the demo schema's
 *  in a demo), its instant and that instant's household day, and who asks.
 *  Built per call by the middleware after the demo-schema one (trpc.ts). */
export type RequestScope = {
  readonly db: DbOrTx;
  readonly asOf: Date;
  readonly today: CalendarDate;
  /** Whether the viewer holds a permission, by userHasPermission; false
   *  with no session. A service that reads more for some viewers asks this
   *  instead of taking the session. */
  readonly can: (permission: Permission) => boolean;
  /** `read(db)`, shared by the request's other query calls on this db
   *  object when the scope has a memo (see ReadMemo); keyed by the loader
   *  itself, so `read` must not depend on anything but the db. */
  readonly load: <T>(read: DbRead<T>) => Promise<T>;
};

type MemoEntry = { generation: number; value: Promise<unknown> };

/** One HTTP request's shared reads, by db object, then by loader. A demo
 *  call's db and a transaction are their own objects, so they never share
 *  a read with the public db or with each other. */
export type ReadMemo = {
  readonly byDb: WeakMap<object, Map<DbRead<unknown>, MemoEntry>>;
  /** Freeze each shared result, so a caller that changes one fails. */
  readonly freeze: boolean;
};

export function createReadMemo(opts?: { freeze?: boolean }): ReadMemo {
  return { byDb: new WeakMap(), freeze: opts?.freeze ?? false };
}

/** Bumped by every successful mutation: an entry read before it is
 *  stale, and a read started before it is never shared after it. */
let readGeneration = 0;

export function invalidateRequestReads(): void {
  readGeneration++;
}

function freezeRows<T>(value: T): T {
  if (Array.isArray(value)) for (const row of value) Object.freeze(row);
  return Object.freeze(value);
}

function memoLoad<T>(memo: ReadMemo, db: DbOrTx, read: DbRead<T>): Promise<T> {
  let entries = memo.byDb.get(db);
  if (!entries) {
    entries = new Map();
    memo.byDb.set(db, entries);
  }
  const hit = entries.get(read);
  if (hit && hit.generation === readGeneration) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the entry under `read` holds read's own result
    return hit.value as Promise<T>;
  }
  const value = Promise.resolve(read(db)).then((rows) =>
    memo.freeze ? freezeRows(rows) : rows,
  );
  const entry: MemoEntry = { generation: readGeneration, value };
  entries.set(read, entry);
  const own = entries;
  value.catch(() => {
    if (own.get(read) === entry) own.delete(read);
  });
  return value;
}

/** A signed-in user's role and permission addons. */
type Viewer = { role: string; permissions: readonly string[] };

/** Whether a signed-in user holds a permission (admins hold all) — the rule withPermission enforces. */
export function userHasPermission(
  user: Viewer,
  permission: Permission,
): boolean {
  return user.role === "admin" || user.permissions.includes(permission);
}

/** `memo`: the request's shared reads, for a query call only; without
 *  one, `load` reads directly. */
export function createRequestScope(
  db: DbOrTx,
  asOf: Date,
  viewer: Viewer | null | undefined,
  memo?: ReadMemo,
): RequestScope {
  return {
    db,
    asOf,
    today: calendarDateOf(asOf),
    can: (permission) =>
      viewer != null && userHasPermission(viewer, permission),
    load: (read) =>
      memo ? memoLoad(memo, db, read) : Promise.resolve(read(db)),
  };
}
