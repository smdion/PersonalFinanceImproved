/**
 * Invented Contribution Profiles for the active-fields shape (stored-JSON
 * tag, v0106-active-fields.ts): each `contribution_active_fields` root as
 * stored and as the shape stores it, the ones it refuses, and the accounts
 * their entries sit over, for the restore step and both migrators.
 */
import { entryWithMergedRate } from "@/lib/pure/contributions/employer-match";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";

/** Accounts as a database row (snake_case); booleans as booleans. */
export const ACCOUNTS = [
  {
    id: 1,
    account_type: "401k",
    tax_treatment: "pre_tax",
    employer_match_type: "none",
    label: "Invented A",
    target_annual: "5000",
    allocation_priority: 2,
    is_payroll_deducted: true,
  },
  {
    id: 3,
    account_type: "hsa",
    tax_treatment: "hsa",
    employer_match_type: "none",
    target_annual: "0",
    allocation_priority: 0,
  },
  {
    id: 2,
    account_type: "ira",
    tax_treatment: "tax_free",
    employer_match_type: "none",
    allocation_priority: 0,
  },
];

/** A value only a refused row holds: never in a message. */
export const SECRET_VALUE = 777123;

const paired = {
  contributionValue: "6",
  contributionMethod: "percent_of_salary",
};
const KEPT = {
  contributionAccounts: {
    "1": { ...paired, fromBonus: true },
    "2": { contributionValue: 7000, contributionMethod: "fixed_annual" },
  },
  deductions: { "7": { amountPerPeriod: "25.00" } },
};

export type ActiveFieldsCase = { id: number; before: unknown; after: unknown };

/** Converted or left alone: none refused. */
export const PROFILES: ActiveFieldsCase[] = [
  { id: 401, before: KEPT, after: KEPT },
  { id: 402, before: {}, after: {} },
  // A JSON null reads as no fields.
  { id: 403, before: null, after: {} },
  // A retired entry key goes.
  {
    id: 404,
    before: {
      contributionAccounts: { "1": { ...paired, displayNameOverride: "x" } },
    },
    after: { contributionAccounts: { "1": paired } },
  },
  // A retired root key goes.
  {
    id: 405,
    before: { ...KEPT, jobs: { "3": { salary: 1 } } },
    after: KEPT,
  },
  // Keys repeating their account's column go.
  {
    id: 406,
    before: {
      contributionAccounts: {
        "1": {
          ...paired,
          allocationPriority: 2,
          targetAnnual: 5000,
          label: "Invented A",
          isPayrollDeducted: true,
          personId: null,
        },
        "2": { ...paired, targetAnnual: null, accountType: "ira" },
      },
    },
    after: { contributionAccounts: { "1": paired, "2": paired } },
  },
  // An entry for an account the install doesn't have goes; a decimal text
  // equal to its column goes.
  {
    id: 407,
    before: {
      contributionAccounts: {
        "3": { ...paired, targetAnnual: "0.00" },
        "99": { ...paired, allocationPriority: 1 },
      },
    },
    after: { contributionAccounts: { "3": paired } },
  },
];

/** Profile ids the converter writes. */
export const WRITTEN = [403, 404, 405, 406, 407];

/** Refused: each names its id and these fields. */
export const REFUSED: (ActiveFieldsCase & { fields: string[] })[] = [
  {
    // A stored null over a set column has no identical target.
    id: 501,
    before: {
      contributionAccounts: { "1": { ...paired, allocationPriority: null } },
    },
    after: null,
    fields: ["allocationPriority"],
  },
  {
    id: 502,
    before: {
      contributionAccounts: { "1": { ...paired, targetAnnual: SECRET_VALUE } },
    },
    after: null,
    fields: ["targetAnnual"],
  },
  {
    id: 503,
    before: { contributionAccounts: { "1": { contributionValue: "6" } } },
    after: null,
    fields: ["contributionValue"],
  },
  {
    id: 504,
    before: {
      contributionAccounts: {
        "1": { contributionValue: "6", contributionMethod: "fortnightly" },
      },
    },
    after: null,
    fields: ["contributionMethod"],
  },
  { id: 505, before: [KEPT], after: null, fields: ["root"] },
  {
    id: 506,
    before: { contributionAccounts: { "1": { ...paired, oldRule: 1 } } },
    after: null,
    fields: ["unlistedKey"],
  },
  {
    id: 507,
    before: { ...KEPT, oldBucket: {} },
    after: null,
    fields: ["unlistedKey"],
  },
  {
    id: 508,
    before: { deductions: { "7": { amountPerPeriod: 25 } } },
    after: null,
    fields: ["deductions"],
  },
  {
    // A number 0 over the column's "0": the read branches on truthiness.
    id: 509,
    before: { contributionAccounts: { "3": { ...paired, targetAnnual: 0 } } },
    after: null,
    fields: ["targetAnnual"],
  },
  {
    // Text over a boolean column reads as truthy text.
    id: 512,
    before: {
      contributionAccounts: { "1": { ...paired, isPayrollDeducted: "true" } },
    },
    after: null,
    fields: ["isPayrollDeducted"],
  },
  {
    // Text over an integer column reads differently.
    id: 510,
    before: {
      contributionAccounts: { "1": { ...paired, allocationPriority: "2" } },
    },
    after: null,
    fields: ["allocationPriority"],
  },
  { id: 511, before: JSON.stringify(KEPT), after: null, fields: ["root"] },
];

/** Each account row as the read gets it (camelCase; decimals as text). */
const accountRows = () =>
  ACCOUNTS.map((a) => ({
    id: a.id,
    jobId: null,
    personId: null,
    accountType: a.account_type,
    subType: null,
    label: a.label ?? null,
    parentCategory: "Retirement",
    taxTreatment: a.tax_treatment,
    employerMatchType: a.employer_match_type,
    employerMatchValue: null,
    employerMatchRate: null,
    employerMaxMatchPct: null,
    employerMatchTaxTreatment: "pre_tax",
    hsaCoverageType: null,
    autoMaximize: false,
    isActive: true,
    ownership: "individual",
    performanceAccountId: null,
    targetAnnual: a.target_annual ?? null,
    allocationPriority: a.allocation_priority,
    notes: null,
    isPayrollDeducted: a.is_payroll_deducted ?? null,
    priorYearContribAmount: "0",
    priorYearContribYear: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));

/** A number's text as the number, so "5000" and 5000 read alike. */
const figure = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : v;

type Buckets = ReturnType<typeof readContributionActiveFields>;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The read before the tag: a refused object root as stored, any other
 *  root as no fields. */
function readBeforeTag(root: unknown): Buckets {
  if (!isObject(root)) return { contributionAccounts: {}, deductions: {} };
  const buckets = root as Partial<Buckets>;
  return {
    contributionAccounts: buckets.contributionAccounts ?? {},
    deductions: buckets.deductions ?? {},
  };
}

/** What the contribution read makes of a root: each account's merged row on
 *  its columns and entry fields (a key neither holds reads nowhere). */
export const profileReads = (root: unknown) =>
  merged(readContributionActiveFields(root, 1));
/** The same, as read before the tag. */
export const profileReadsBeforeTag = (root: unknown) =>
  merged(readBeforeTag(root));

function merged(fields: Buckets) {
  const rows = accountRows();
  const keys = new Set([
    ...Object.keys(rows[0]!),
    "contributionValue",
    "contributionMethod",
    "employerMatchRate",
    "fromBonus",
    "rothRoute",
    "displayNameCustom",
  ]);
  return {
    // applyContribActiveFields' merge (services/contributions/profile.ts),
    // which the db test project can't load.
    accounts: rows.flatMap((row) => {
      const entry = fields.contributionAccounts[String(row.id)];
      if (!entry || entry["contributionValue"] === undefined) return [];
      const merged: Record<string, unknown> = {
        ...row,
        ...entryWithMergedRate(row, entry),
        fromBonus: entry["fromBonus"] === true,
      };
      return [
        Object.fromEntries(
          Object.entries(merged)
            .filter(([k]) => keys.has(k))
            .map(([k, v]) => [k, figure(v)]),
        ),
      ];
    }),
    deductions: fields.deductions,
  };
}
