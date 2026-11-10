/** The stored-JSON tag's contribution active fields, live and on restore:
 *  an object root, keys nothing reads or that repeat their account's column
 *  gone, and the start refused for anything else the read refuses. */
// No import from migration-converters.ts, which registers this one.
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  ROTH_IRA_ROUTE_VALUES,
} from "../../config/enum-values";
import { ConverterRefusal } from "./converter-refusal";
import {
  asBool,
  isRow,
  parsedJson,
  type Row,
  type Update,
} from "./converter-rows";
import {
  UNLISTED_KEY,
  isBoolean,
  isText,
  oneOf,
  refusedKeys,
  type Check,
  type Fields,
} from "./frozen-shape";

const PROFILES = "contribution_profiles";
const ACCOUNTS = "contribution_accounts";

/** An entry key nothing reads, and a root key nothing reads (the old
 *  per-job bucket). Only grow. */
const RETIRED_ENTRY_KEYS: readonly string[] = ["displayNameOverride"];
const RETIRED_ROOT_KEYS: readonly string[] = ["jobs"];

type ColumnKind = "text" | "integer" | "decimal" | "boolean";

/** contribution_accounts columns an entry can repeat outside its shape, as
 *  of this tag (key, column, how it compares): the read spreads an entry
 *  over its row, so such a key goes only where it equals the column. */
const COLUMN_KEYS: Readonly<Record<string, readonly [string, ColumnKind]>> = {
  jobId: ["job_id", "integer"],
  personId: ["person_id", "integer"],
  accountType: ["account_type", "text"],
  subType: ["sub_type", "text"],
  label: ["label", "text"],
  parentCategory: ["parent_category", "text"],
  taxTreatment: ["tax_treatment", "text"],
  employerMatchTaxTreatment: ["employer_match_tax_treatment", "text"],
  hsaCoverageType: ["hsa_coverage_type", "text"],
  ownership: ["ownership", "text"],
  performanceAccountId: ["performance_account_id", "integer"],
  targetAnnual: ["target_annual", "decimal"],
  allocationPriority: ["allocation_priority", "integer"],
  notes: ["notes", "text"],
  isPayrollDeducted: ["is_payroll_deducted", "boolean"],
  priorYearContribAmount: ["prior_year_contrib_amount", "decimal"],
  priorYearContribYear: ["prior_year_contrib_year", "integer"],
};

/** Whether the entry reads exactly as its column does, spread over the
 *  row: a boolean only as a boolean; a decimal (read as text, branched on
 *  by truthiness) with the column's truthiness and number; null over null. */
function sameAsColumn(kind: ColumnKind, entry: unknown, column: unknown) {
  const absent = column === null || column === undefined;
  if (entry === null || absent) return entry === null && absent;
  if (kind === "text") return entry === column;
  if (kind === "boolean")
    return typeof entry === "boolean" && entry === asBool(column);
  if (kind === "integer")
    return typeof entry === "number" && entry === Number(column);
  if (typeof entry !== "number" && typeof entry !== "string") return false;
  const text = String(column);
  return (
    Boolean(entry) === Boolean(text) &&
    Number.isFinite(Number(entry)) &&
    Number(entry) === Number(text)
  );
}

const numberOrText: Check = (v) =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
const decimalText: Check = (v) =>
  typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));

// Each closed set is its values as of this tag and the config's now: a
// value a later release adds is never refused, and one it retires is
// still read here until that release's own tag converts it.
const METHODS = [
  ...["percent_of_salary", "fixed_per_period", "fixed_monthly", "fixed_annual"],
  ...CONTRIBUTION_METHOD_VALUES,
];
const MATCH_TYPES = [
  ...["none", "percent_of_contribution", "dollar_match", "fixed_annual"],
  ...EMPLOYER_MATCH_TYPE_VALUES,
];
const ROTH_ROUTES = [...["direct", "backdoor"], ...ROTH_IRA_ROUTE_VALUES];
/** contribAccountActiveFieldsSchema's fields with the read's closed sets,
 *  as of this tag: a test holds the live keys inside these. */
export const ACTIVE_FIELDS_ENTRY_FIELDS: Fields = {
  contributionValue: { check: numberOrText, optional: true },
  contributionMethod: {
    check: oneOf(METHODS),
    optional: true,
  },
  employerMatchType: {
    check: oneOf(MATCH_TYPES),
    optional: true,
  },
  employerMatchValue: { check: numberOrText, optional: true },
  employerMatchRate: { check: numberOrText, optional: true },
  employerMaxMatchPct: { check: numberOrText, optional: true },
  autoMaximize: { check: isBoolean, optional: true },
  isActive: { check: isBoolean, optional: true },
  fromBonus: { check: isBoolean, optional: true },
  rothRoute: { check: oneOf(ROTH_ROUTES), optional: true },
  displayNameCustom: { check: isText, optional: true },
};

/** deductionActiveFieldsSchema's fields as of this tag. */
export const DEDUCTION_ENTRY_FIELDS: Fields = {
  amountPerPeriod: { check: decimalText, optional: true },
};

const ENTRY_KEYS: readonly string[] = Object.keys(ACTIVE_FIELDS_ENTRY_FIELDS);
const ROOT = "root";
const ACCOUNT_BUCKET = "contributionAccounts";
const DEDUCTION_BUCKET = "deductions";

const NOT_READABLE = "contribution_active_fields_not_readable";

type Checked = { entry: unknown; changed: boolean; refused: string[] };

/** One account entry: retired keys and keys equal to their column gone;
 *  the field names of anything the read would refuse. */
function checkAccountEntry(entry: unknown, account: Row | undefined): Checked {
  if (!isRow(entry))
    return { entry, changed: false, refused: [ACCOUNT_BUCKET] };
  const kept: Row = {};
  const refused: string[] = [];
  let changed = false;
  for (const [key, value] of Object.entries(entry)) {
    const column = Object.hasOwn(COLUMN_KEYS, key) ? COLUMN_KEYS[key] : null;
    if (ENTRY_KEYS.includes(key)) kept[key] = value;
    else if (RETIRED_ENTRY_KEYS.includes(key)) changed = true;
    else if (!column) refused.push(UNLISTED_KEY);
    else if (account && sameAsColumn(column[1], value, account[column[0]]))
      changed = true;
    else refused.push(key);
  }
  refused.push(...refusedKeys(kept, ACTIVE_FIELDS_ENTRY_FIELDS, true));
  if (
    Object.hasOwn(kept, "contributionValue") !==
    Object.hasOwn(kept, "contributionMethod")
  )
    refused.push("contributionValue");
  return { entry: changed ? kept : entry, changed, refused };
}

/** The account bucket with each entry checked, an entry for an account
 *  the install doesn't have gone (nothing reads it; only when the accounts
 *  were read); written when one changed. */
function checkAccounts(
  bucket: unknown,
  accounts: ReadonlyMap<string, Row> | null,
): Checked {
  if (!isRow(bucket))
    return { entry: bucket, changed: false, refused: [ACCOUNT_BUCKET] };
  const next: Row = {};
  const refused: string[] = [];
  let changed = false;
  for (const [accountId, entry] of Object.entries(bucket)) {
    if (accounts && !accounts.has(accountId)) {
      changed = true;
      continue;
    }
    const c = checkAccountEntry(entry, accounts?.get(accountId));
    refused.push(...c.refused);
    next[accountId] = c.entry;
    changed ||= c.changed;
  }
  return { entry: changed ? next : bucket, changed, refused };
}

const deductionsRefused = (bucket: unknown): string[] =>
  isRow(bucket) &&
  Object.values(bucket).every(
    (e) =>
      isRow(e) && refusedKeys(e, DEDUCTION_ENTRY_FIELDS, true).length === 0,
  )
    ? []
    : [DEDUCTION_BUCKET];

/** A profile's root as it is to be stored (write) or its refused fields.
 *  A JSON null reads as no fields (written as {}), a backup row without the
 *  column takes its default; any other non-object root is refused. */
function checkRoot(
  raw: unknown,
  accounts: ReadonlyMap<string, Row> | null,
): { root: Row; write: boolean; refused: string[] } {
  if (raw === undefined) return { root: {}, write: false, refused: [] };
  const value = parsedJson(raw);
  if (value === null) return { root: {}, write: true, refused: [] };
  if (!isRow(value)) return { root: {}, write: false, refused: [ROOT] };
  const root: Row = {};
  const refused: string[] = [];
  let write = false;
  for (const [key, bucket] of Object.entries(value)) {
    if (RETIRED_ROOT_KEYS.includes(key)) {
      write = true;
      continue;
    }
    root[key] = bucket;
    if (key === ACCOUNT_BUCKET) {
      const c = checkAccounts(bucket, accounts);
      refused.push(...c.refused);
      root[key] = c.entry;
      write ||= c.changed;
    } else if (key === DEDUCTION_BUCKET)
      refused.push(...deductionsRefused(bucket));
    else refused.push(UNLISTED_KEY);
  }
  return { root, write, refused };
}

// Gated on structure (the root's type, keys from fixed lists) and an entry
// key's equality with its column; removing keys is a projection, so a replay
// finds nothing. It never touches a key the entry shape holds.
export const ACTIVE_FIELDS_CONVERTER = {
  tables: [ACCOUNTS, PROFILES],
  runs: "afterSql",
  refusals: {
    [NOT_READABLE]: {
      problem:
        "Contribution Profiles hold a value or key their accounts can't read",
      upgradeFix:
        "Start the previous version; in each listed Contribution Profile, set the listed fields of its accounts again (or clear them); then upgrade again.",
      restoreFix:
        "Restore it in the version that made it, do the same there, back it up again and restore that backup.",
      fields: [
        ROOT,
        ACCOUNT_BUCKET,
        DEDUCTION_BUCKET,
        UNLISTED_KEY,
        ...ENTRY_KEYS,
        ...Object.keys(COLUMN_KEYS),
      ],
    },
  },
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const accountRows = tables[ACCOUNTS];
    const accounts = accountRows
      ? new Map(accountRows.filter(isRow).map((a) => [String(a["id"]), a]))
      : null;
    const updates: Update[] = [];
    const refusedIds: number[] = [];
    const fields: string[] = [];
    for (const profile of (tables[PROFILES] ?? []).filter(isRow)) {
      const id = Number(profile["id"]);
      const c = checkRoot(profile["contribution_active_fields"], accounts);
      if (c.refused.length > 0) {
        refusedIds.push(id);
        fields.push(...c.refused);
      } else if (c.write)
        updates.push({
          table: PROFILES,
          id,
          set: { contribution_active_fields: c.root },
        });
    }
    if (refusedIds.length > 0)
      throw new ConverterRefusal(NOT_READABLE, { [PROFILES]: refusedIds }, [
        ...new Set(fields),
      ]);
    return {
      updates,
      notes: [
        `${updates.length} Contribution Profiles' active fields given an object root or cleared of keys nothing reads`,
      ],
    };
  },
} as const;
