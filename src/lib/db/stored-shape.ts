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

function fitsShape<S extends z.ZodType>(
  shape: S,
  alsoChecked: readonly z.ZodType[],
  value: unknown,
  issues: string[],
): value is z.output<S> {
  for (const check of [shape, ...alsoChecked])
    for (const i of check.safeParse(value).error?.issues ?? [])
      issues.push(`${i.path.join(".")}: ${i.message}`);
  return issues.length === 0;
}

/** `value` checked against `shape`, then each of `alsoChecked` (a stricter
 *  read of the same value), every refusal's issues in that order; a refused
 *  value is logged through `log`. */
export function readStoredShape<S extends z.ZodType>(
  value: unknown,
  shape: S,
  log: StoredShapeLog,
  alsoChecked: readonly z.ZodType[] = [],
): StoredShapeRead<z.output<S>> {
  const issues: string[] = [];
  if (fitsShape(shape, alsoChecked, value, issues))
    return { fits: true, value };
  logWarnOnce(log.event, log.key(issues), log.data(issues));
  return { fits: false, asStored: value, issues };
}

/** The read's value, a refused one passed on as stored: the old stored
 *  shape fallback (docs/FALLBACKS.md). A shape's reader stops calling this
 *  once its migration converts every row, and throws on a refused read. */
export function passOnAsStored<T>(read: StoredShapeRead<T>): T {
  if (read.fits) return read.value;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one place a refused stored value passes on as stored (any install loads) until its shape's migration
  return read.asStored as T;
}
