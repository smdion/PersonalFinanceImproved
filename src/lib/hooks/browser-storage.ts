/**
 * Browser storage read through the shape its writer stores. Any version, tab
 * or hand can leave any text under a key: unset, unreadable or refused reads
 * as unset, and a refused value warns once per key (FALLBACKS § Browser storage).
 */

/** A check that a parsed value has the shape its writer stores. */
export type StoredFits<T> = (value: unknown) => value is T;

const warned = new Set<string>();

/** Warns once per key that a stored value didn't fit (never the value). */
export function warnStoredShape(key: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn("browser_storage_unexpected_shape", key);
}

/** `text` parsed as JSON when it is JSON and fits; undefined otherwise, and a
 *  refused text warns once under `key`. */
export function parseStoredJson<T>(
  key: string,
  text: string,
  fits: StoredFits<T>,
): T | undefined {
  let value: unknown;
  let parsed = false;
  try {
    value = JSON.parse(text);
    parsed = true;
  } catch {
    // not JSON: refused below
  }
  if (parsed && fits(value)) return value;
  warnStoredShape(key);
  return undefined;
}

/** The JSON under `key` in localStorage when it fits; undefined when unset,
 *  unreadable (storage can throw) or refused. */
export function readBrowserJson<T>(
  key: string,
  fits: StoredFits<T>,
): T | undefined {
  let text: string | null = null;
  try {
    text = localStorage.getItem(key);
  } catch {
    // storage unavailable (private window, blocked site data): unset
  }
  return text === null ? undefined : parseStoredJson(key, text, fits);
}

export const isBoolean: StoredFits<boolean> = (v) => typeof v === "boolean";

/** One of `values`, compared as stored. */
export function oneOf<const V extends readonly unknown[]>(
  values: V,
): StoredFits<V[number]> {
  return (v): v is V[number] => values.includes(v);
}

/** A plain object (not null, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
