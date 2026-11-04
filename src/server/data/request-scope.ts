import type { Db, DbOrTx } from "@/lib/db";
import { calendarDateOf, type CalendarDate } from "@/lib/utils/calendar-date";

/** What one tRPC procedure call reads against: its db (the demo schema's
 *  in a demo), the instant it runs at and that instant's household day.
 *  Built per call by the middleware after the demo-schema one (trpc.ts). */
export type RequestScope = {
  readonly db: DbOrTx;
  readonly asOf: Date;
  readonly today: CalendarDate;
};

export function createRequestScope(db: Db, asOf: Date): RequestScope {
  return { db, asOf, today: calendarDateOf(asOf) };
}
