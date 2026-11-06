/** Migration 0016 and its restore step: a percent match's rate, as a
 *  fraction, beside the whole-percent value, which stays (DESIGN § Data-
 *  converting migrations). Rules: MATCH_RATE_CONVERTER. */
// No import from migration-converters.ts, which registers this one.

export const MATCH_RATE_TAG = "0016_v0102_match_rate";

const PERCENT = "percent_of_contribution";

/** A profile entry's match type: its own when it sets one (null included),
 *  else the account's, as applyContribActiveFields merges them. */
export function effectiveMatchType(
  entry: Readonly<Record<string, unknown>>,
  accountType: unknown,
): unknown {
  return Object.hasOwn(entry, "employerMatchType")
    ? entry["employerMatchType"]
    : accountType;
}

/** employer_match_rate is decimal(12,6): six integer digits. */
const MAX_INTEGER_DIGITS = 6;
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** A stored whole percent as a fraction, by moving the decimal point in the
 *  text: "50.00" → "0.5", "3.5" → "0.035", "0.5" → "0.005". Null for one
 *  that isn't a plain decimal ("", "abc", "1e2") or doesn't fit. */
export function rateFromPercent(stored: unknown): string | null {
  const text =
    typeof stored === "number" && Number.isFinite(stored)
      ? String(stored)
      : typeof stored === "string"
        ? stored.trim()
        : "";
  const m = DECIMAL.exec(text);
  const intPart = m?.[2] ?? "";
  const fracPart = m?.[3] ?? "";
  if (!m || intPart + fracPart === "") return null;
  const digits = intPart.padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = (digits.slice(-2) + fracPart).replace(/0+$/, "");
  if (whole.length > MAX_INTEGER_DIGITS) return null;
  const sign = m[1] === "-" && (whole !== "0" || fraction !== "") ? "-" : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown) => v === null || v === undefined;

/** A JSON column in either dialect's form (PostgreSQL: an object, SQLite:
 *  text) as an object; null for anything else, text that isn't JSON too. */
function jsonObject(value: unknown): Row | null {
  let v: unknown = value;
  if (typeof v === "string")
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  return isRow(v) ? v : null;
}

type Update = { table: string; id: number; set: Row };
type Converted = { updates: Update[]; skipped: string[] };

/** Rows typed `percent_of_contribution` with a value and no rate yet. */
function accountRates(rows: readonly Row[], out: Converted): void {
  for (const row of rows) {
    const value = row["employer_match_value"];
    if (row["employer_match_type"] !== PERCENT) continue;
    if (!isEmpty(row["employer_match_rate"]) || isEmpty(value)) continue;
    const rate = rateFromPercent(value);
    if (rate === null) out.skipped.push(`account ${String(row["id"])}`);
    else
      out.updates.push({
        table: "contribution_accounts",
        id: Number(row["id"]),
        set: { employer_match_rate: rate },
      });
  }
}

/** The rate an entry stores: from its own value under a percent type, or
 *  from the account's value it borrows when the account's own type isn't a
 *  percent; the account's rate column stays empty then. */
function entryValue(entry: Row, account: Row | undefined): unknown {
  if (!isEmpty(entry["employerMatchRate"])) return null;
  const accountType = account?.["employer_match_type"];
  if (effectiveMatchType(entry, accountType) !== PERCENT) return null;
  if (Object.hasOwn(entry, "employerMatchValue"))
    return entry["employerMatchValue"];
  return accountType === PERCENT ? null : account?.["employer_match_value"];
}

/** Each profile's entries that resolve to a percent and hold no rate yet. */
function entryRates(
  profiles: readonly Row[],
  accounts: ReadonlyMap<string, Row>,
  out: Converted,
): number {
  let filled = 0;
  for (const profile of profiles) {
    const fields = jsonObject(profile["contribution_active_fields"]);
    const entries = fields?.["contributionAccounts"];
    if (!fields || !isRow(entries)) continue;
    const next: Row = { ...entries };
    let changed = false;
    for (const [accountId, entry] of Object.entries(entries)) {
      if (!isRow(entry)) continue;
      const value = entryValue(entry, accounts.get(accountId));
      if (isEmpty(value)) continue;
      const rate = rateFromPercent(value);
      if (rate === null) {
        out.skipped.push(`profile ${String(profile["id"])} entry ${accountId}`);
        continue;
      }
      next[accountId] = { ...entry, employerMatchRate: rate };
      changed = true;
      filled++;
    }
    if (changed)
      out.updates.push({
        table: "contribution_profiles",
        id: Number(profile["id"]),
        set: {
          contribution_active_fields: { ...fields, contributionAccounts: next },
        },
      });
  }
  return filled;
}

/** The type decides, never the value (every version stored whole
 *  percents); a discount account (ESPP) too, as the engine reads it under
 *  its match type. Writes only an empty rate, so it never divides twice. */
export const MATCH_RATE_CONVERTER = {
  tables: ["contribution_accounts", "contribution_profiles"],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const out: Converted = { updates: [], skipped: [] };
    const accounts = (tables["contribution_accounts"] ?? []).filter(isRow);
    accountRates(accounts, out);
    const accountCount = out.updates.length;
    const byId = new Map(accounts.map((a) => [String(a["id"]), a]));
    const profiles = (tables["contribution_profiles"] ?? []).filter(isRow);
    const entries = entryRates(profiles, byId, out);
    const notes = [`${accountCount} account rates, ${entries} entry rates`];
    if (out.skipped.length > 0)
      notes.push(
        `left without a rate (not a decimal that fits): ${out.skipped.join(", ")}`,
      );
    return { updates: out.updates, notes };
  },
} as const;
