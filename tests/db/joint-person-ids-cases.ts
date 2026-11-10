/**
 * Invented contribution rows for the credentials tag's joint step: joint
 * rows naming a person (with a job, or set to a method that needs none),
 * which the step clears; rows it leaves; and one it can't decide (joint, a
 * person, no job, a profile setting it to a percent of salary).
 */
export const PEOPLE = [
  { id: 1, name: "Avery Invented", date_of_birth: "1980-01-01" },
  { id: 2, name: "Blake Invented", date_of_birth: "1982-02-02" },
];
export const JOBS = [
  {
    id: 1,
    person_id: 1,
    employer_name: "Invented Co",
    start_date: "2020-01-01",
  },
];

const account = (
  id: number,
  ownership: string,
  personId: number | null,
  jobId: number | null,
) => ({
  id,
  ownership,
  person_id: personId,
  job_id: jobId,
  account_type: "brokerage",
  tax_treatment: "after_tax",
  employer_match_type: "none",
});

/** Each row, and its person_id after the step. */
export const ACCOUNT_CASES = [
  {
    what: "joint, a person and a job",
    row: account(1, "joint", 1, 1),
    after: null,
  },
  {
    what: "joint, a person, a fixed amount",
    row: account(2, "joint", 2, null),
    after: null,
  },
  {
    what: "joint, a person, no profile entry",
    row: account(3, "joint", 1, null),
    after: null,
  },
  {
    what: "joint, no person",
    row: account(4, "joint", null, null),
    after: null,
  },
  {
    what: "individual, a person",
    row: account(5, "individual", 2, null),
    after: 2,
  },
] as const;

/** The one row the step can't decide. */
export const UNDECIDABLE = account(6, "joint", 2, null);

/** Profiles: row 2 at a fixed amount, row 6 (and the individual row 5) at a
 *  percent of salary in the second profile only. */
export const PROFILES = [
  {
    id: 101,
    name: "Invented A",
    contribution_active_fields: {
      contributionAccounts: { "2": { contributionMethod: "fixed_monthly" } },
    },
  },
  {
    id: 102,
    name: "Invented B",
    contribution_active_fields: {
      contributionAccounts: {
        "5": { contributionMethod: "percent_of_salary" },
        "6": { contributionMethod: "percent_of_salary" },
      },
    },
  },
];

/** Every name: none may appear in a note or a refusal. */
export const NAMES = ["Avery Invented", "Blake Invented", "Invented Co"];
