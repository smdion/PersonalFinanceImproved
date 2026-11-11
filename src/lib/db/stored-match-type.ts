/** contribution_accounts.employer_match_type as read: free text with no CHECK.
 *  "" is a known spelling of no match; any other value outside the set is
 *  logged once per account and read as no match, marked so the account says so. */
import { z } from "zod/v4";
import type { EmployerMatchType } from "@/lib/config/enum-values";
import { employerMatchTypeSchema } from "@/lib/config/enum-values.schema";
import { readStoredShape } from "@/lib/db/stored-shape";
import { effectiveMatchType } from "@/lib/utils/match-rate";

const storedMatchType = z.union([employerMatchTypeSchema, z.literal("")]);

/** The match type an account row takes once a profile entry merges onto it
 *  (the entry's own, else the account's). */
export function readStoredMatchType(
  row: { id: number; employerMatchType: unknown },
  entry: Readonly<Record<string, unknown>>,
): { employerMatchType: EmployerMatchType; matchTypeUnrecognised?: true } {
  const stored = effectiveMatchType(entry, row.employerMatchType);
  const read = readStoredShape(stored, storedMatchType, {
    event: "contribution_account_unknown_match_type",
    key: () => String(row.id),
    data: () => ({ accountId: row.id, stored }),
  });
  if (!read.fits)
    return { employerMatchType: "none", matchTypeUnrecognised: true };
  return { employerMatchType: read.value === "" ? "none" : read.value };
}
