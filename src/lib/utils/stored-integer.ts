/** A stored integer setting (a profile id, a budget column, a snapshot id)
 *  however it was stored: an integer, or the digit string an older
 *  PostgreSQL write left; `unset` when absent or not one. */
export function storedInteger<U>(raw: unknown, unset: U): number | U {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return unset;
}
