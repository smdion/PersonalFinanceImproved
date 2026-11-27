/** The projection's notes naming each contribution account whose employer
 *  match is saved below 0, in the active or a switched-to Contribution
 *  Profile; the match is read as none and the stored value is kept. */
import type * as schema from "@/lib/db/schema";
import type { EmployerMatchType } from "@/lib/config/enum-values";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { parseEmployerMatch } from "@/lib/pure/contributions/contribution-amount";
import { storedMatchRate } from "@/lib/pure/contributions/employer-match";
import { toNumber } from "@/lib/utils/numbers";
import type { RetirementData } from "@/server/services/projection/engine-payload/load";
import { contributionAccountName } from "./account-name";
import { applyContribActiveFields } from "./profile";

/** A contribution row's stored match terms, as its readers take them. */
type StoredMatch = {
  employerMatchType: EmployerMatchType | null;
  employerMatchValue: string | number | null;
  employerMatchRate?: string | number | null;
  employerMaxMatchPct: string | number | null;
};

/** Whether a row's match is set but read as none: saved below 0. */
export function hasNegativeMatch(row: StoredMatch): boolean {
  const type = row.employerMatchType ?? "none";
  if (type === "none") return false;
  const match = parseEmployerMatch(
    type,
    toNumber(row.employerMatchValue),
    toNumber(row.employerMaxMatchPct),
    storedMatchRate(row.employerMatchRate),
  );
  return match.kind === "none";
}

/** One note per account and profile it is read in (the active one, or one a
 *  "Changes by year" row switches to), naming both. */
export function negativeMatchNotes(
  data: RetirementData,
  switchProfiles: Iterable<typeof schema.contributionProfiles.$inferSelect>,
): string[] {
  const performanceAccountsById = new Map(
    data.perfAccounts.map((p) => [p.id, p]),
  );
  const nameMap = new Map(data.people.map((p) => [p.id, p.name]));
  const notes = new Set<string>();
  for (const profile of [data.contributionProfileRow, ...switchProfiles]) {
    if (!profile) continue;
    const entries = readContributionActiveFields(
      profile.contributionActiveFields,
      profile.id,
    ).contributionAccounts;
    for (const row of applyContribActiveFields(data.allContribsRaw, entries)) {
      if (!hasNegativeMatch(row)) continue;
      const account = contributionAccountName(
        row,
        { performanceAccountsById, jobs: data.allJobs },
        nameMap,
      );
      notes.add(
        `${account}'s employer match in the Contribution Profile "${profile.name}" is below 0, which no employer pays, so the projection counts no match for it there. Set its match on the Contributions page with that profile open.`,
      );
    }
  }
  return [...notes];
}
