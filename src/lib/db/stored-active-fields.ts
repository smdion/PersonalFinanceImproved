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

const warned = new Set<string>();

/** Logs a refused row once per process, not on every read. */
function warnOnce(profileId: number | undefined, issues: string[]): void {
  const key = `${profileId}|${issues.join(";")}`;
  if (warned.has(key)) return;
  warned.add(key);
  log("warn", "contribution_active_fields_unexpected_shape", {
    profileId,
    issues,
  });
}

/** Both buckets, each `{}` when the profile sets nothing in it; a root that
 *  isn't an object (a hand-edited JSON null) reads as empty. */
export function readContributionActiveFields(
  stored: EntityFieldMap,
  profileId?: number,
): ContributionActiveFieldsRoot {
  const root: unknown = stored;
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    warnOnce(profileId, ["root: not an object"]);
    return { contributionAccounts: {}, deductions: {} };
  }
  const issues = [contributionActiveFieldsSchema, closedSetValues].flatMap(
    (schema) => schema.safeParse(stored).error?.issues ?? [],
  );
  if (issues.length > 0)
    warnOnce(
      profileId,
      issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return {
    contributionAccounts: stored.contributionAccounts ?? {},
    deductions: stored.deductions ?? {},
  };
}
