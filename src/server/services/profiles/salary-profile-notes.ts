/** The Salary Profile a page computes on, with the notes naming what its read left out. */
import { TRPCError } from "@trpc/server";
import type { DbOrTx } from "@/lib/db";
import { applySalaryProfileRow } from "@/lib/pure/household/compensation";
import { unreadableSalaryNotes } from "@/lib/db/stored-salary-entries";
import { fetchEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";

/** loadEffectiveSalaryProfile's map for a save that records what it reads:
 *  refused, naming each, while an entry of a job in `jobs` can't be read. */
export async function loadReadableSalaryProfile(
  db: DbOrTx,
  salaryProfileId: number | null | undefined,
  jobs: readonly { id: number; employerName: string }[],
) {
  const { salaryMap, notes } = await loadEffectiveSalaryProfileNoted(
    db,
    salaryProfileId,
    jobs,
  );
  if (notes.length > 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: notes.join(" ") });
  return salaryMap;
}

/** loadEffectiveSalaryProfile's map, and a note for each entry of a job in
 *  `jobs` that the read left out (shown where its figures are). */
export async function loadEffectiveSalaryProfileNoted(
  db: DbOrTx,
  salaryProfileId: number | null | undefined,
  jobs: readonly { id: number; employerName: string }[],
) {
  const profile = await fetchEffectiveSalaryProfile(db, salaryProfileId);
  return {
    salaryMap: applySalaryProfileRow(profile),
    notes: profile ? unreadableSalaryNotes(profile, jobs) : [],
  };
}
