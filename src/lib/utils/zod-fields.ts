// Zod fields shared across routers and JSONB active-field schemas. Server
// code only: a client component that imports this file bundles Zod.
import { z } from "zod/v4";

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
