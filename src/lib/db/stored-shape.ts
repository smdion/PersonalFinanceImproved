/**
 * The one reader every stored value goes through: checked against its
 * writer's shape; a refused one is logged once and marked as stored, so each
 * shape's reader says what it reads as until its migration, then throws.
 */
import type { z } from "zod/v4";
import { logWarnOnce } from "@/lib/logger";

/** A stored value as read: the value itself, never a parsed copy (a writer
 *  that saves it back loses no key), typed as its shape's output. */
export type StoredShapeRead<T> =
  | { fits: true; value: T }
  | { fits: false; asStored: unknown; issues: string[] };

/** How a refused value is logged: once per process per event and key. */
export type StoredShapeLog = {
  event: string;
  key: (issues: string[]) => string;
  data: (issues: string[]) => Record<string, unknown>;
};

type NewKeys = z.core.$ZodIssueUnrecognizedKeys;

/** A refusal that is only keys a strict shape doesn't know: a newer Ledgr's. */
const isNewKeys = (issue: z.core.$ZodIssue): issue is NewKeys =>
  issue.code === "unrecognized_keys";

function fitsShape<S extends z.ZodType>(
  shape: S,
  alsoChecked: readonly z.ZodType[],
  value: unknown,
  issues: string[],
  readPastNewKeys: boolean,
): value is z.output<S> {
  for (const check of [shape, ...alsoChecked])
    for (const i of check.safeParse(value).error?.issues ?? [])
      if (!readPastNewKeys || !isNewKeys(i))
        issues.push(`${i.path.join(".")}: ${i.message}`);
  return issues.length === 0;
}

/** `value` checked against `shape`, then each of `alsoChecked` (stricter), a
 *  refused one logged through `log`. `readPastNewKeys`: a key a strict shape
 *  doesn't know (a newer Ledgr's) is no refusal and stays in the value. */
export function readStoredShape<S extends z.ZodType>(
  value: unknown,
  shape: S,
  log: StoredShapeLog,
  alsoChecked: readonly z.ZodType[] = [],
  readPastNewKeys = false,
): StoredShapeRead<z.output<S>> {
  const issues: string[] = [];
  if (fitsShape(shape, alsoChecked, value, issues, readPastNewKeys))
    return { fits: true, value };
  logWarnOnce(log.event, log.key(issues), log.data(issues));
  return { fits: false, asStored: value, issues };
}

/** How a stored value refused by its shape is logged: once per `source`
 *  (`app_settings.<key>`, `<table>.<column>`), with its first five issues. */
export function storedValueLog(source: string): StoredShapeLog {
  return {
    event: "stored_value_unexpected_shape",
    key: () => source,
    data: (issues) => ({ source, issues: issues.slice(0, 5) }),
  };
}

/** The read's value, a refused one passed on as stored: the old stored
 *  shape fallback (docs/FALLBACKS.md). A shape's reader stops calling this
 *  once its migration converts every row, and throws on a refused read. */
export function passOnAsStored<T>(read: StoredShapeRead<T>): T {
  if (read.fits) return read.value;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one place a refused stored value passes on as stored (any install loads) until its shape's migration
  return read.asStored as T;
}

/** The object at `path` in `value` (a record or a list), if there is one. */
function objectAt(
  value: unknown,
  path: readonly PropertyKey[],
): object | undefined {
  let at = value;
  for (const key of path)
    at = typeof at === "object" && at !== null ? Reflect.get(at, key) : null;
  return typeof at === "object" && at !== null ? at : undefined;
}

/** A writer's parse of `value`, each new key a strict shape refuses read past
 *  and put back at its stored path in the parse (so `shape` must have no
 *  transform that changes the value's structure). */
export function parseKeepingNewKeys<S extends z.ZodType>(
  shape: S,
  value: unknown,
):
  | { success: true; data: z.output<S> }
  | { success: false; issues: z.core.$ZodIssue[] } {
  const first = shape.safeParse(value);
  if (first.success) return first;
  const newKeys = first.error.issues.filter(isNewKeys);
  if (newKeys.length < first.error.issues.length)
    return {
      success: false,
      issues: first.error.issues.filter((i) => !isNewKeys(i)),
    };
  const checked: unknown = structuredClone(value);
  for (const { path, keys } of newKeys) {
    const at = objectAt(checked, path);
    for (const key of keys) if (at) Reflect.deleteProperty(at, key);
  }
  const parsed = shape.safeParse(checked);
  if (!parsed.success) return { success: false, issues: parsed.error.issues };
  for (const { path, keys } of newKeys) {
    const from = objectAt(value, path);
    const to = objectAt(parsed.data, path);
    for (const key of keys)
      if (from && to) Reflect.set(to, key, Reflect.get(from, key));
  }
  return { success: true, data: parsed.data };
}
