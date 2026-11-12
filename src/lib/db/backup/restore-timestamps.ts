/** A backup's timestamps in the form the target dialect stores: SQLite keeps epoch seconds,
 *  PostgreSQL timestamptz text. Which columns convert comes from the schema; a value is
 *  converted only when it is in the other dialect's form. */
import { isRow } from "../migrate/converter-rows";
import { schemaColumnsOfType } from "./schema-columns";

/** Every timestamp column's name, by table. */
const TIMESTAMP_COLUMNS = new Map(
  [...schemaColumnsOfType((type) => type.startsWith("timestamp"))].map(
    ([table, columns]) => [table, columns.map((c) => c.name)] as const,
  ),
);

/** A date and time as PostgreSQL or ISO text writes it: nothing looser is read. With no
 *  offset (a plain `timestamp` column, as the earliest supported PostgreSQL schema had) it
 *  is read as UTC, the zone every later version's pool reads it in (`timezone=UTC`). */
const TIMESTAMP_TEXT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2})(?::?(\d{2}))?)?$/;

/** A year both dialects store: PostgreSQL has no year 0, and past 9999 ISO text turns "+0YYYYY". */
const isStoredYear = (year: number) => year >= 1 && year <= 9999;

/** The text's instant in ms, read field by field (the engine's date parser reads a
 *  space-separated year below 100 as 19xx or 20xx); undefined when its date or time would roll
 *  over (February 30, 24:00) or its year isn't stored. No offset is UTC. */
function instantOf(match: RegExpExecArray): number | undefined {
  const [, year, month, day, hour, minute, second = "00"] = match;
  const [sign, offsetHours = "0", offsetMinutes = "0"] = match.slice(8);
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second));
  const fields = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (!isStoredYear(Number(year)) || !date.toISOString().startsWith(fields))
    return undefined;
  // PostgreSQL's offsets run to ±15:59.
  if (Number(offsetHours) > 15 || Number(offsetMinutes) > 59) return undefined;
  const offset = Number(offsetHours) * 60 + Number(offsetMinutes);
  const ms = date.getTime() - (sign === "-" ? -offset : offset) * 60_000;
  return isStoredYear(new Date(ms).getUTCFullYear()) ? ms : undefined;
}

/** The value as `target` stores it; undefined when it can't be read as a time. A PostgreSQL
 *  time onto SQLite keeps whole seconds, the precision SQLite stores. */
function converted(value: unknown, target: "postgres" | "sqlite"): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime()) || !isStoredYear(date.getUTCFullYear()))
      return undefined;
    return target === "sqlite" ? value : date.toISOString();
  }
  const match = typeof value === "string" ? TIMESTAMP_TEXT.exec(value) : null;
  const ms = match ? instantOf(match) : undefined;
  if (!match || ms === undefined) return undefined;
  if (target === "sqlite") return ms / 1000;
  return match[7] ? match[0] : `${match[0]}Z`;
}

/** Converts every timestamp of `tables` in place for `target`; throws naming each table and
 *  column holding a value that isn't a time (never the value), before anything is written. */
export function convertTimestampsFor(
  tables: Record<string, unknown[]>,
  target: "postgres" | "sqlite",
): void {
  const unreadable = new Set<string>();
  for (const [table, columns] of TIMESTAMP_COLUMNS)
    for (const row of tables[table] ?? []) {
      if (!isRow(row)) continue;
      for (const column of columns) {
        if (!Object.hasOwn(row, column)) continue;
        const value = converted(row[column], target);
        if (value === undefined) unreadable.add(`${table}.${column}`);
        else row[column] = value;
      }
    }
  if (unreadable.size > 0)
    throw new Error(
      `This backup holds values that aren't a time in ${[...unreadable].join(", ")}. Nothing was restored.`,
    );
}
