// Zod fields shared across routers and JSONB active-field schemas. Server
// code only: a client component that imports this file bundles Zod.
import { z } from "zod/v4";
import { isCalendarDate } from "./date";

/** A string holding a finite number: never "", "NaN" or "Infinity". */
export const zDecimal = z
  .string()
  .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), {
    message: "Must be a valid number",
  });

/** A decimal string between 0 and 1: a share stored as a fraction (0.06 is
 *  6%), never a whole-number percent. */
export const zFraction = zDecimal.refine(
  (v) => Number(v) >= 0 && Number(v) <= 1,
  { message: "Must be a fraction between 0 and 1 (0.06 for 6%)" },
);

/** A calendar year a request may name, 1900–2100: one range for every
 *  year field. For router inputs, never for stored JSON. */
export const zYear = z.number().int().min(1900).max(2100);

/** A `YYYY-MM-DD` request field naming a real day in a zYear year. For
 *  router inputs, never for stored JSON (its parsers keep their own
 *  check, so a stored value an older version accepted still reads). */
export const zCalendarDate = z.string().refine(isCalendarDate, {
  message: "Must be a real date, YYYY-MM-DD, between 1900 and 2100",
});

/** A `YYYY-MM` request month (a real month in a zYear year). */
export const zMonthKey = z
  .string()
  .refine((v) => /^\d{4}-\d{2}$/.test(v) && isCalendarDate(`${v}-01`), {
    message: "Must be a real month, YYYY-MM, between 1900 and 2100",
  });
