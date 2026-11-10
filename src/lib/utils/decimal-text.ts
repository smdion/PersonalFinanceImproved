/** Decimal text in the one form both databases return: no trailing
 *  fractional zeros ("300.00" → "300", "0.500000" → "0.5"), as PostgreSQL
 *  gives a numeric at its scale and SQLite gives the text as written. */
export function canonicalDecimalText(text: string): string {
  if (!/^-?\d+\.\d+$/.test(text)) return text;
  const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}
