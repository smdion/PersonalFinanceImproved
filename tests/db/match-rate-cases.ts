/**
 * Employer match rows and profile entries before and after migration 0016
 * (employer_match_rate / employerMatchRate). One list for the migration on
 * both dialects and the restore step, so all three agree on every case.
 */
export type AccountCase = {
  name: string;
  id: number;
  type: string;
  value: string | null;
  /** A rate already stored: the converter keeps it. */
  rate?: string;
  subType?: string;
  after: string | null;
  /** Text only SQLite's text column can hold (PostgreSQL's is decimal). */
  sqliteOnly?: true;
};

export const ACCOUNT_CASES: AccountCase[] = [
  {
    name: "a whole percent",
    id: 1,
    type: "percent_of_contribution",
    value: "50",
    after: "0.5",
  },
  {
    name: "PostgreSQL's decimal text",
    id: 2,
    type: "percent_of_contribution",
    value: "3.50",
    after: "0.035",
  },
  {
    name: "a value typed as a fraction stays 0.5%",
    id: 3,
    type: "percent_of_contribution",
    value: "0.5",
    after: "0.005",
  },
  {
    name: "over 100%",
    id: 4,
    type: "percent_of_contribution",
    value: "150",
    after: "1.5",
  },
  {
    name: "100%",
    id: 5,
    type: "percent_of_contribution",
    value: "100.00",
    after: "1",
  },
  {
    name: "no value",
    id: 6,
    type: "percent_of_contribution",
    value: null,
    after: null,
  },
  {
    name: "a rate already stored is kept",
    id: 7,
    type: "percent_of_contribution",
    value: "50",
    rate: "0.25",
    after: "0.25",
  },
  {
    name: "dollar_match: dollars, no rate",
    id: 8,
    type: "dollar_match",
    value: "1000",
    after: null,
  },
  {
    name: "fixed_annual: dollars, no rate",
    id: 9,
    type: "fixed_annual",
    value: "950",
    after: null,
  },
  {
    name: "none with a leftover value",
    id: 10,
    type: "none",
    value: "50",
    after: null,
  },
  {
    name: "an unknown type reads as none",
    id: 11,
    type: "Percent_of_contribution",
    value: "50",
    after: null,
  },
  {
    name: "an ESPP discount under a percent type",
    id: 12,
    type: "percent_of_contribution",
    value: "15",
    subType: "espp",
    after: "0.15",
  },
  {
    name: "an ESPP discount under a dollar type",
    id: 13,
    type: "fixed_annual",
    value: "15",
    subType: "espp",
    after: null,
  },
  {
    name: "a negative percent",
    id: 14,
    type: "percent_of_contribution",
    value: "-5",
    after: "-0.05",
  },
  {
    name: "the largest that fits",
    id: 15,
    type: "percent_of_contribution",
    value: "99999999.99",
    after: "999999.9999",
  },
  {
    name: "SQLite text: spaces",
    id: 16,
    type: "percent_of_contribution",
    value: " 50 ",
    after: "0.5",
    sqliteOnly: true,
  },
  {
    name: "SQLite text: empty",
    id: 17,
    type: "percent_of_contribution",
    value: "",
    after: null,
    sqliteOnly: true,
  },
  {
    name: "SQLite text: not a number",
    id: 18,
    type: "percent_of_contribution",
    value: "fifty",
    after: null,
    sqliteOnly: true,
  },
  {
    name: "SQLite text: an exponent reads as parseFloat reads it",
    id: 19,
    type: "percent_of_contribution",
    value: "1e2",
    after: "1",
    sqliteOnly: true,
  },
  {
    name: "SQLite text: too large for the rate column",
    id: 20,
    type: "percent_of_contribution",
    value: "123456789",
    after: null,
    sqliteOnly: true,
  },
  {
    name: "SQLite text: more decimals than PostgreSQL keeps",
    id: 21,
    type: "percent_of_contribution",
    value: "3.14159",
    after: "0.0314159",
    sqliteOnly: true,
  },
  {
    name: "SQLite text: a capital exponent",
    id: 22,
    type: "percent_of_contribution",
    value: "5E1",
    after: "0.5",
    sqliteOnly: true,
  },
  {
    name: "SQLite text: a percent sign after the number",
    id: 23,
    type: "percent_of_contribution",
    value: "50%",
    after: "0.5",
    sqliteOnly: true,
  },
  {
    name: "SQLite text: letters after the number",
    id: 24,
    type: "percent_of_contribution",
    value: " 50abc",
    after: "0.5",
    sqliteOnly: true,
  },
];

/** Accounts the profile cases point at (none is deleted: 99 has no row). */
const PERCENT = 1; // percent_of_contribution, "50"
const DOLLAR = 8; // dollar_match, "1000"
const NONE_LEFTOVER = 10; // none, "50"
const UNKNOWN = 11;
const DELETED = 99;

export type ProfileCase = { name: string; before: unknown; after: unknown };

const accounts = (entries: Record<string, unknown>) => ({
  contributionAccounts: entries,
});

export const PROFILE_CASES: ProfileCase[] = [
  {
    name: "a value of its own on a percent account",
    before: accounts({
      [PERCENT]: { employerMatchValue: "60", isActive: true },
    }),
    after: accounts({
      [PERCENT]: {
        employerMatchValue: "60",
        isActive: true,
        employerMatchRate: "0.6",
      },
    }),
  },
  {
    name: "a number of its own",
    before: accounts({ [PERCENT]: { employerMatchValue: 50 } }),
    after: accounts({
      [PERCENT]: { employerMatchValue: 50, employerMatchRate: "0.5" },
    }),
  },
  {
    name: "a value of its own on a dollar account stays dollars",
    before: accounts({ [DOLLAR]: { employerMatchValue: "500" } }),
    after: accounts({ [DOLLAR]: { employerMatchValue: "500" } }),
  },
  {
    name: "a percent type and value of its own on a dollar account",
    before: accounts({
      [DOLLAR]: {
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "25",
      },
    }),
    after: accounts({
      [DOLLAR]: {
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "25",
        employerMatchRate: "0.25",
      },
    }),
  },
  {
    name: "a percent type borrowing a none account's leftover value",
    before: accounts({
      [NONE_LEFTOVER]: { employerMatchType: "percent_of_contribution" },
    }),
    after: accounts({
      [NONE_LEFTOVER]: {
        employerMatchType: "percent_of_contribution",
        employerMatchRate: "0.5",
      },
    }),
  },
  {
    name: "a percent type borrowing a dollar account's value",
    before: accounts({
      [DOLLAR]: { employerMatchType: "percent_of_contribution" },
    }),
    after: accounts({
      [DOLLAR]: {
        employerMatchType: "percent_of_contribution",
        employerMatchRate: "10",
      },
    }),
  },
  {
    name: "a percent type borrowing a percent account's value: the column has it",
    before: accounts({
      [PERCENT]: { employerMatchType: "percent_of_contribution" },
    }),
    after: accounts({
      [PERCENT]: { employerMatchType: "percent_of_contribution" },
    }),
  },
  {
    name: "a dollar type over a percent account",
    before: accounts({
      [PERCENT]: {
        employerMatchType: "dollar_match",
        employerMatchValue: "200",
      },
    }),
    after: accounts({
      [PERCENT]: {
        employerMatchType: "dollar_match",
        employerMatchValue: "200",
      },
    }),
  },
  {
    name: "a dollar type alone over a percent account (step 3's case)",
    before: accounts({ [PERCENT]: { employerMatchType: "fixed_annual" } }),
    after: accounts({ [PERCENT]: { employerMatchType: "fixed_annual" } }),
  },
  {
    name: "a null or unknown type reads as none",
    before: accounts({
      [PERCENT]: { employerMatchType: null, employerMatchValue: "5" },
      [UNKNOWN]: { employerMatchValue: "5" },
      "12": { employerMatchType: "percent", employerMatchValue: "5" },
    }),
    after: accounts({
      [PERCENT]: { employerMatchType: null, employerMatchValue: "5" },
      [UNKNOWN]: { employerMatchValue: "5" },
      "12": { employerMatchType: "percent", employerMatchValue: "5" },
    }),
  },
  {
    name: "a deleted account: its own percent type converts, else it is left",
    before: accounts({
      [DELETED]: {
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "40",
      },
      "98": { employerMatchValue: "40" },
      "97": { employerMatchType: "percent_of_contribution" },
    }),
    after: accounts({
      [DELETED]: {
        employerMatchType: "percent_of_contribution",
        employerMatchValue: "40",
        employerMatchRate: "0.4",
      },
      "98": { employerMatchValue: "40" },
      "97": { employerMatchType: "percent_of_contribution" },
    }),
  },
  {
    name: "a rate already stored is kept, a null one is filled",
    before: accounts({
      [PERCENT]: { employerMatchValue: "50", employerMatchRate: "0.1" },
      "2": { employerMatchValue: "50", employerMatchRate: null },
    }),
    after: accounts({
      [PERCENT]: { employerMatchValue: "50", employerMatchRate: "0.1" },
      "2": { employerMatchValue: "50", employerMatchRate: "0.5" },
    }),
  },
  {
    name: "a value that isn't a decimal, or null, is left without a rate",
    before: accounts({
      [PERCENT]: { employerMatchValue: "" },
      "2": { employerMatchValue: "abc" },
      "3": { employerMatchValue: null },
      "4": { employerMatchValue: true },
    }),
    after: accounts({
      [PERCENT]: { employerMatchValue: "" },
      "2": { employerMatchValue: "abc" },
      "3": { employerMatchValue: null },
      "4": { employerMatchValue: true },
    }),
  },
  {
    name: "JSON numbers String() writes with an exponent, and a trailing sign",
    before: accounts({
      [PERCENT]: { employerMatchValue: 1e-7 },
      "2": { employerMatchValue: 1e21 },
      "3": { employerMatchValue: "50%" },
    }),
    after: accounts({
      [PERCENT]: { employerMatchValue: 1e-7, employerMatchRate: "0.000000001" },
      "2": { employerMatchValue: 1e21 },
      "3": { employerMatchValue: "50%", employerMatchRate: "0.5" },
    }),
  },
  {
    name: "other entries and keys of the column are kept",
    before: {
      contributionAccounts: {
        [PERCENT]: { employerMatchValue: "6", employerMaxMatchPct: "0.06" },
        "2": { isActive: false },
        "3": "not an entry",
        "4": null,
        "5": [1, 2],
        "6": JSON.stringify({ employerMatchValue: "50" }),
      },
      deductions: { "1": { amountPerPeriod: "50" } },
    },
    after: {
      contributionAccounts: {
        [PERCENT]: {
          employerMatchValue: "6",
          employerMaxMatchPct: "0.06",
          employerMatchRate: "0.06",
        },
        "2": { isActive: false },
        "3": "not an entry",
        "4": null,
        "5": [1, 2],
        "6": JSON.stringify({ employerMatchValue: "50" }),
      },
      deductions: { "1": { amountPerPeriod: "50" } },
    },
  },
  { name: "JSON null", before: null, after: null },
  { name: "an empty object", before: {}, after: {} },
  {
    name: "contributionAccounts null",
    before: { contributionAccounts: null },
    after: { contributionAccounts: null },
  },
  {
    name: "contributionAccounts not an object",
    before: { contributionAccounts: [{ employerMatchValue: "50" }] },
    after: { contributionAccounts: [{ employerMatchValue: "50" }] },
  },
  { name: "a column that is an array", before: [], after: [] },
];

/** SQLite text the column holds that isn't JSON: left as it is. */
export const NOT_JSON = [
  "not json",
  '{"contributionAccounts": {"1": {"employerMatchValue": "50"',
];
