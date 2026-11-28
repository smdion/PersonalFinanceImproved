/**
 * salary_profiles.salaries as read: each job's entry checked on its own (a newer Ledgr's key read
 * past and kept). One this version can't read is left out and named, and stays stored.
 */
import { z } from "zod/v4";
import { salaryEntrySchema } from "@/lib/db/shapes/json-schemas";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { readStoredShape, type StoredShapeLog } from "@/lib/db/stored-shape";

type SalaryProfileRow = {
  id: number;
  salaries: Record<string, SalaryEntry>;
};

/** What a read left out: each unreadable entry as stored, by job id, and
 *  whether the root itself is unreadable (then it has no entries). */
export type UnreadableSalaryEntries = {
  entries: Record<string, unknown>;
  root: boolean;
};

const storedRoot = z.record(z.string(), z.unknown());

const entryLog = (profileId: number, job?: string): StoredShapeLog => ({
  event: "salary_entries_unexpected_shape",
  key: (issues) => `${profileId}|${job}|${issues.slice(0, 10)}`,
  data: (issues) => ({ profileId, job, issues: issues.slice(0, 10) }),
});

/** The row's stored entries by job id, each unread; null when the root isn't
 *  an object of entries (logged once per process). */
export function storedSalaryEntries(
  row: SalaryProfileRow,
): Record<string, unknown> | null {
  const root = readStoredShape(row.salaries, storedRoot, entryLog(row.id));
  return root.fits ? root.value : null;
}

/** The row with the entries this version can read; the rest, as stored, in
 *  `unreadable` (each logged once per process). */
export function checkSalaryEntries<R extends SalaryProfileRow>(
  row: R,
): Omit<R, "salaries"> & {
  salaries: Record<string, SalaryEntry>;
  unreadable: UnreadableSalaryEntries;
} {
  const root = storedSalaryEntries(row);
  if (!root)
    return { ...row, salaries: {}, unreadable: { entries: {}, root: true } };
  const salaries: Record<string, SalaryEntry> = {};
  const entries: Record<string, unknown> = {};
  for (const [job, entry] of Object.entries(root)) {
    const read = readStoredShape(
      entry,
      salaryEntrySchema,
      entryLog(row.id, job),
      [],
      true,
    );
    if (read.fits) salaries[job] = read.value;
    else entries[job] = entry;
  }
  const allRead = Object.keys(entries).length === 0;
  return {
    ...row,
    salaries: allRead ? row.salaries : salaries,
    unreadable: { entries, root: false },
  };
}

/** `next` with each stored entry this version can't read put back as
 *  stored, unless `next` sets that job: a save never drops one. */
export function withUnreadableEntries(
  unreadable: UnreadableSalaryEntries,
  next: Record<string, SalaryEntry>,
): Record<string, SalaryEntry> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- entries this version can't read are written back as stored, unchanged
  return { ...(unreadable.entries as Record<string, SalaryEntry>), ...next };
}

/** The notes naming what a read of `profile` left out; an entry for a job
 *  not in `jobs` is read by nothing, so it isn't named. */
export function unreadableSalaryNotes(
  profile: { name: string; unreadable: UnreadableSalaryEntries },
  jobs: readonly { id: number; employerName: string }[],
): string[] {
  const where = `Salary Profile "${profile.name}"`;
  if (profile.unreadable.root)
    return [
      `The saved salaries in ${where} can't be read by this version of Ledgr, so it has none. Update Ledgr, or enter them again.`,
    ];
  return jobs
    .filter((job) => String(job.id) in profile.unreadable.entries)
    .map(
      (job) =>
        `The saved salary for ${job.employerName} in ${where} can't be read by this version of Ledgr, so that job has none there. Update Ledgr, or enter it again.`,
    );
}
