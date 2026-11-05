/** Parse Drizzle decimal string to number. */
export function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return parseFloat(v);
}
