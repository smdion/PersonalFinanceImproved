/**
 * contribution_profiles.contribution_active_fields as read: checked once, a
 * row the check refuses is logged and read as stored (any install loads).
 */
import { z } from "zod/v4";
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
} from "@/lib/config/enum-values";
import { contributionActiveFieldsSchema } from "@/lib/db/json-schemas";
import type { EntityFieldMap } from "@/lib/db/schema";
import { log } from "@/lib/logger";

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

/** Both buckets, each `{}` when the profile sets nothing in it. */
export function readContributionActiveFields(
  stored: EntityFieldMap,
  profileId?: number,
): ContributionActiveFieldsRoot {
  const issues = [contributionActiveFieldsSchema, closedSetValues].flatMap(
    (schema) => schema.safeParse(stored).error?.issues ?? [],
  );
  if (issues.length > 0)
    log("warn", "contribution_active_fields_unexpected_shape", {
      profileId,
      issues: issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  return {
    contributionAccounts: stored.contributionAccounts ?? {},
    deductions: stored.deductions ?? {},
  };
}
