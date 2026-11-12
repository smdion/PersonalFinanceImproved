/** Parse Drizzle decimal string (or a number already read) to number. */
export function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

/** Parse Drizzle decimal string to number, keeping a missing value (null or
 *  undefined) as null instead of 0. */
export function toNumberOrNull(v: string | null | undefined): number | null {
  return v == null ? null : toNumber(v);
}
