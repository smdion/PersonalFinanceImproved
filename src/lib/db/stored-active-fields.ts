/**
 * contribution_profiles.contribution_active_fields as read: checked once;
 * the stored-JSON migration converts or refuses every row, so a row the
 * check refuses (a hand edit since) throws, naming the profile.
 */
import { contributionActiveFieldsSchema } from "@/lib/db/shapes/json-schemas";
import { readStoredShape } from "@/lib/db/stored-shape";

export type ContributionActiveFieldsRoot = {
  contributionAccounts: Record<string, Record<string, unknown>>;
  deductions: Record<string, Record<string, unknown>>;
};

/** Both buckets, each `{}` when the profile sets nothing in it; throws on
 *  a root of another shape (the refusal logged once per process). */
export function readContributionActiveFields(
  stored: unknown,
  profileId?: number,
): ContributionActiveFieldsRoot {
  const read = readStoredShape(stored, contributionActiveFieldsSchema, {
    event: "contribution_active_fields_unexpected_shape",
    key: (issues) => `${profileId}|${issues.join(";")}`,
    data: (issues) => ({ profileId, issues }),
  });
  if (!read.fits)
    throw new Error(
      `Contribution Profile ${profileId ?? "(unsaved)"}: its stored active fields don't fit their shape`,
    );
  // As stored, a bucket the schema defaults may be missing.
  const root: Partial<ContributionActiveFieldsRoot> = read.value;
  return {
    contributionAccounts: root.contributionAccounts ?? {},
    deductions: root.deductions ?? {},
  };
}
