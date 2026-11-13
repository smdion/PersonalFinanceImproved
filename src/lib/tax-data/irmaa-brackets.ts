/** A tax-data file's IRMAA brackets: the stored row shape, and each tier's
 *  optional Part B and Part D both given and summing to its surcharge. */
import { z } from "zod/v4";
import { irmaaBracketsSchema } from "@/lib/db/shapes/json-schemas";

const tierShape = z.looseObject({
  annualSurcharge: z.number(),
  partB: z.unknown().optional(),
  partD: z.unknown().optional(),
});

const partsAddUp = (tier: unknown): boolean => {
  const parsed = tierShape.safeParse(tier);
  if (!parsed.success) return false;
  const { partB, partD, annualSurcharge } = parsed.data;
  if (partB === undefined && partD === undefined) return true;
  return (
    typeof partB === "number" &&
    typeof partD === "number" &&
    Math.abs(partB + partD - annualSurcharge) < 0.005
  );
};

export const irmaaFileBracketsSchema = z
  .unknown()
  .refine(
    (b) =>
      irmaaBracketsSchema.safeParse(b).success &&
      Array.isArray(b) &&
      b.every(partsAddUp),
  );
