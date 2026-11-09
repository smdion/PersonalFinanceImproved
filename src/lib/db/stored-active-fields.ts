/**
 * contribution_profiles.contribution_active_fields as read: checked once, a
 * row the check refuses is logged and read as stored (any install loads).
 */
import { z } from "zod/v4";
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
} from "@/lib/config/enum-values";
import { contributionActiveFieldsSchema } from "@/lib/db/shapes/json-schemas";
import {
  passOnAsStored,
  readStoredShape,
  type StoredShapeLog,
} from "@/lib/db/stored-shape";

/** The write schema takes any string here; a read holds them to their sets. */
const closedSetValues = z.object({
  contributionAccounts: z
    .record(
      z.string(),
      z.object({
        contributionMethod: z.enum(CONTRIBUTION_METHOD_VALUES).optional(),
        employerMatchType: z.enum(EMPLOYER_MATCH_TYPE_VALUES).optional(),
      }),
    )
    .optional(),
});

export type ContributionActiveFieldsRoot = {
  contributionAccounts: Record<string, Record<string, unknown>>;
  deductions: Record<string, Record<string, unknown>>;
};

/** A root a hand edit left as something other than an object. */
const objectRoot = z.custom<Record<string, unknown>>(
  (root) => typeof root === "object" && root !== null && !Array.isArray(root),
  { message: "not an object", path: ["root"] },
);

/** Logs a refused row once per process, not on every read. */
function refusedRow(profileId: number | undefined): StoredShapeLog {
  return {
    event: "contribution_active_fields_unexpected_shape",
    key: (issues) => `${profileId}|${issues.join(";")}`,
    data: (issues) => ({ profileId, issues }),
  };
}

/** Both buckets, each `{}` when the profile sets nothing in it; a root that
 *  isn't an object (a hand-edited JSON null) reads as empty. */
export function readContributionActiveFields(
  stored: unknown,
  profileId?: number,
): ContributionActiveFieldsRoot {
  const root = readStoredShape(stored, objectRoot, refusedRow(profileId));
  if (!root.fits) return { contributionAccounts: {}, deductions: {} };
  // As stored, a bucket the schema defaults may be missing.
  const fields: Partial<ContributionActiveFieldsRoot> = passOnAsStored(
    readStoredShape(
      root.value,
      contributionActiveFieldsSchema,
      refusedRow(profileId),
      [closedSetValues],
    ),
  );
  return {
    contributionAccounts: fields.contributionAccounts ?? {},
    deductions: fields.deductions ?? {},
  };
}
