/**
 * Employer match rows and profile entries before and after migration 0017
 * (a percent match keeps its rate alone), from the state 0016 leaves. One
 * list for the migration on both dialects and the restore step.
 */
const PERCENT = "percent_of_contribution";

export type ValueCase = {
  name: string;
  id: number;
  type: string;
  value: string | null;
  rate: string | null;
  /** employer_match_value after 0017. */
  after: string | null;
  /** Text only SQLite's text columns can hold. */
  sqliteOnly?: true;
};

export const VALUE_ACCOUNTS: ValueCase[] = [
  {
    name: "a percent with its rate",
    id: 1,
    type: PERCENT,
    value: "50.00",
    rate: "0.5",
    after: null,
  },
  {
    name: "the account a dollar entry borrows from",
    id: 2,
    type: PERCENT,
    value: "40.00",
    rate: "0.4",
    after: null,
  },
  {
    name: "a value 0016 left without a rate keeps it",
    id: 3,
    type: PERCENT,
    value: "abc",
    rate: null,
    after: "abc",
    sqliteOnly: true,
  },
  {
    name: "a value too large for a rate keeps it",
    id: 4,
    type: PERCENT,
    value: "100000000.00",
    rate: null,
    after: "100000000.00",
  },
  {
    name: "already cleared",
    id: 5,
    type: PERCENT,
    value: null,
    rate: "0.5",
    after: null,
  },
  {
    name: "a dollar match keeps its dollars",
    id: 6,
    type: "dollar_match",
    value: "500.00",
    rate: null,
    after: "500.00",
  },
  {
    name: "none with a leftover value",
    id: 7,
    type: "none",
    value: "50.00",
    rate: null,
    after: "50.00",
  },
  {
    name: "a rate the readers can't read keeps the value",
    id: 8,
    type: PERCENT,
    value: "50",
    rate: "abc",
    after: "50",
    sqliteOnly: true,
  },
  {
    name: "fixed_annual keeps its dollars",
    id: 9,
    type: "fixed_annual",
    value: "1000.00",
    rate: null,
    after: "1000.00",
  },
];

export type ValueProfileCase = {
  name: string;
  before: unknown;
  after: unknown;
  sqliteOnly?: true;
};

const entries = (e: Record<string, unknown>) => ({
  contributionAccounts: e,
  deductions: {},
});

export const VALUE_PROFILES: ValueProfileCase[] = [
  {
    name: "a percent entry's own value goes where its rate is set",
    before: entries({
      "1": {
        contributionValue: "6",
        contributionMethod: "percent_of_salary",
        employerMatchValue: "40",
        employerMatchRate: "0.4",
      },
    }),
    after: entries({
      "1": {
        contributionValue: "6",
        contributionMethod: "percent_of_salary",
        employerMatchRate: "0.4",
      },
    }),
  },
  {
    name: "a dollar type alone over a cleared percent account takes the account's value (decision 14)",
    before: entries({
      "2": { employerMatchType: "dollar_match" },
      "1": { employerMatchType: "fixed_annual", isActive: true },
    }),
    after: entries({
      "2": { employerMatchType: "dollar_match", employerMatchValue: "40.00" },
      "1": {
        employerMatchType: "fixed_annual",
        isActive: true,
        employerMatchValue: "50.00",
      },
    }),
  },
  {
    name: "a dollar type alone over an account 0016 left keeps borrowing it",
    before: entries({ "4": { employerMatchType: "dollar_match" } }),
    after: entries({ "4": { employerMatchType: "dollar_match" } }),
  },
  {
    name: "a dollar type with its own value keeps it",
    before: entries({
      "1": { employerMatchType: "dollar_match", employerMatchValue: "300" },
    }),
    after: entries({
      "1": { employerMatchType: "dollar_match", employerMatchValue: "300" },
    }),
  },
  {
    name: "a rate 0016 baked from a dollar account stays the entry's own",
    before: entries({
      "6": { employerMatchType: PERCENT, employerMatchRate: "5" },
    }),
    after: entries({
      "6": { employerMatchType: PERCENT, employerMatchRate: "5" },
    }),
  },
  {
    name: "a percent type and value of its own on a dollar account",
    before: entries({
      "6": {
        employerMatchType: PERCENT,
        employerMatchValue: 40,
        employerMatchRate: "0.4",
      },
    }),
    after: entries({
      "6": { employerMatchType: PERCENT, employerMatchRate: "0.4" },
    }),
  },
  {
    name: "a dormant rate under a dollar account is left",
    before: entries({
      "6": { employerMatchValue: "40", employerMatchRate: "0.4" },
    }),
    after: entries({
      "6": { employerMatchValue: "40", employerMatchRate: "0.4" },
    }),
  },
  {
    name: "a value with no rate, or one the readers can't read, is kept",
    before: entries({
      "1": { employerMatchValue: "abc" },
      "2": { employerMatchValue: "45", employerMatchRate: "abc" },
      "5": { employerMatchValue: null, employerMatchRate: "0.4" },
    }),
    after: entries({
      "1": { employerMatchValue: "abc" },
      "2": { employerMatchValue: "45", employerMatchRate: "abc" },
      "5": { employerMatchValue: null, employerMatchRate: "0.4" },
    }),
  },
  {
    name: "a deleted account: its own percent clears, a dollar type alone is left",
    before: entries({
      "99": {
        employerMatchType: PERCENT,
        employerMatchValue: "40",
        employerMatchRate: "0.4",
      },
      "98": { employerMatchType: "dollar_match" },
    }),
    after: entries({
      "99": { employerMatchType: PERCENT, employerMatchRate: "0.4" },
      "98": { employerMatchType: "dollar_match" },
    }),
  },
  {
    name: "other keys of the column are kept",
    before: {
      contributionAccounts: {
        "1": {
          contributionValue: "6",
          contributionMethod: "percent_of_salary",
          employerMatchValue: "50",
          employerMatchRate: "0.5",
        },
        "9": { contributionValue: "100", contributionMethod: "fixed_annual" },
      },
      deductions: { "3": { amountPerPeriod: "20" } },
      extra: [1, 2],
    },
    after: {
      contributionAccounts: {
        "1": {
          contributionValue: "6",
          contributionMethod: "percent_of_salary",
          employerMatchRate: "0.5",
        },
        "9": { contributionValue: "100", contributionMethod: "fixed_annual" },
      },
      deductions: { "3": { amountPerPeriod: "20" } },
      extra: [1, 2],
    },
  },
  { name: "JSON null", before: null, after: null },
  {
    name: "contributionAccounts null",
    before: { contributionAccounts: null },
    after: { contributionAccounts: null },
  },
  { name: "a column that is an array", before: [], after: [] },
];
