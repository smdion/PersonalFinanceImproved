/** Invented Salary Profiles for the job-entries tag: entries for jobs the
 *  install has stay as stored, entries for job ids it lacks go. */
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";

export const PERSON = { id: 61, name: "Invented Earner" };

export const JOBS = [
  {
    id: 71,
    person_id: 61,
    employer_name: "Invented Co",
    start_date: "2020-01-01",
  },
  {
    id: 72,
    person_id: 61,
    employer_name: "Invented Two",
    start_date: "2021-01-01",
  },
] as const;

const entry = (salary: number) => ({ ...BLANK_SALARY_ENTRY, salary });

export type JobEntriesCase = {
  readonly id: number;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
};

export const PROFILES: readonly JobEntriesCase[] = [
  // Every entry has its job: untouched.
  {
    id: 801,
    before: { "71": entry(1), "72": entry(2) },
    after: { "71": entry(1), "72": entry(2) },
  },
  // A deleted job's entry goes; the other stays.
  {
    id: 802,
    before: { "71": entry(3), "99": entry(4) },
    after: { "71": entry(3) },
  },
  // Only deleted jobs: the root becomes empty.
  { id: 803, before: { "98": entry(5), "99": entry(6) }, after: {} },
  // No entries.
  { id: 804, before: {}, after: {} },
];

/** The profiles the converter writes. */
export const WRITTEN = [802, 803];
