/** A write's employer match: no figure, rate or ceiling below 0, since no
 *  employer pays a negative match. The stored-JSON schemas still read one
 *  (`parseEmployerMatch` reads it as no match), so these are write-only. */
import { z } from "zod/v4";
import { zDecimal } from "@/lib/utils/zod-fields";
import {
  contribAccountActiveFieldsPatchSchema,
  contribAccountActiveFieldsSchema,
  contributionActiveFieldsSchema,
} from "./json-schemas";

const MATCH_BELOW_ZERO = "An employer match can't be below 0";

/** A contribution account's match figure or rate, as a decimal string. */
export const zMatchFigure = zDecimal.refine((v) => Number(v) >= 0, {
  message: MATCH_BELOW_ZERO,
});

const MATCH_FIELDS = [
  "employerMatchValue",
  "employerMatchRate",
  "employerMaxMatchPct",
] as const;

/** Each match field a profile entry sets below 0, refused at its path. */
function refuseNegativeMatch(
  entry: Partial<Record<(typeof MATCH_FIELDS)[number], unknown>>,
  ctx: z.RefinementCtx,
) {
  for (const field of MATCH_FIELDS)
    if (Number(entry[field]) < 0)
      ctx.addIssue({
        code: "custom",
        message: MATCH_BELOW_ZERO,
        path: [field],
      });
}

/** One account's active fields as a patch sends them. */
export const contributionAccountFieldsPatchWriteSchema =
  contribAccountActiveFieldsPatchSchema.superRefine(refuseNegativeMatch);

/** A profile's active fields as a create or an update sends them. */
export const contributionActiveFieldsWriteSchema =
  contributionActiveFieldsSchema
    .unwrap()
    .extend({
      contributionAccounts: z
        .record(
          z.string(),
          contribAccountActiveFieldsSchema.superRefine(refuseNegativeMatch),
        )
        .default({}),
    })
    .default({ contributionAccounts: {}, deductions: {} });
