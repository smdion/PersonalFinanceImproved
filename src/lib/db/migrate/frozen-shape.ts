/** A stored JSON value checked against a shape written as data, as of a
 *  converter's tag: the migrator bundle takes no npm package, so a
 *  converter checks with these, never with the live zod schemas. */
import { isRow, type Row } from "./converter-rows";

export type Check = (value: unknown) => boolean;

export const isText: Check = (v) => typeof v === "string";
export const isBoolean: Check = (v) => typeof v === "boolean";
export const isNumber: Check = (v) =>
  typeof v === "number" && Number.isFinite(v);

/** A number in [min, max], a whole one when `whole`. */
export const numberIn =
  (min: number, max = Infinity, whole = false): Check =>
  (v) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!whole || Number.isInteger(v));

export const oneOf =
  (set: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && set.includes(v);
export const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
export const arrayOf =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
/** An object whose every key passes `key` and every value `check`. */
export const recordOf =
  (check: Check, key: (k: string) => boolean = () => true): Check =>
  (v) =>
    isRow(v) && Object.entries(v).every(([k, x]) => key(k) && check(x));

/** A field's check, and whether its key may be absent. */
export type Field = { readonly check: Check; readonly optional?: true };
export type Fields = Readonly<Record<string, Field>>;

/** How a key outside a strict shape is named: this word, never the key. */
export const UNLISTED_KEY = "unlistedKey";

/** The fields of `value` that fail: missing (unless optional) or failing
 *  their check, and (strict) a key outside `fields` as UNLISTED_KEY. */
export function refusedKeys(
  value: Row,
  fields: Fields,
  strict: boolean,
): string[] {
  const out: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) {
      if (!field.optional) out.push(key);
    } else if (!field.check(value[key])) out.push(key);
  }
  if (strict)
    for (const key of Object.keys(value))
      if (!Object.hasOwn(fields, key)) out.push(UNLISTED_KEY);
  return out;
}

/** An object holding every required field, each passing; strict, no
 *  other key. */
export const objectOf =
  (fields: Fields, strict: boolean): Check =>
  (v) =>
    isRow(v) && refusedKeys(v, fields, strict).length === 0;
