import type { Db, DbOrTx } from "@/lib/db";
import type { Permission } from "@/lib/config/permissions";
import { calendarDateOf, type CalendarDate } from "@/lib/utils/calendar-date";

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
};

/** A signed-in user's role and permission addons. */
type Viewer = { role: string; permissions: readonly string[] };

/** Whether a signed-in user holds a permission (admins hold all) — the rule withPermission enforces. */
export function userHasPermission(
  user: Viewer,
  permission: Permission,
): boolean {
  return user.role === "admin" || user.permissions.includes(permission);
}

export function createRequestScope(
  db: Db,
  asOf: Date,
  viewer: Viewer | undefined,
): RequestScope {
  return {
    db,
    asOf,
    today: calendarDateOf(asOf),
    can: (permission) =>
      viewer !== undefined && userHasPermission(viewer, permission),
  };
}
