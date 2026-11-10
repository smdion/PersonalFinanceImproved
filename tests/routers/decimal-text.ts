/**
 * Decimal text in SQLite's form, so one assertion holds on both databases:
 * PostgreSQL returns a numeric column at its scale ("300.00", "0.500000")
 * where SQLite returns what was written ("300", "0.5"). Strings that read
 * as decimals lose their trailing zeros, inside arrays and plain objects
 * too; anything else is returned as it is.
 */
export function decimalText<T>(value: T): T {
  if (typeof value === "string")
    return (
      /^-?\d+\.\d+$/.test(value)
        ? value.replace(/0+$/, "").replace(/\.$/, "")
        : value
    ) as T;
  if (Array.isArray(value)) return value.map(decimalText) as T;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [k, decimalText(v)]),
    ) as T;
  return value;
}
