/** Migration 0016 and its restore step: a percent match's rate, as a
 *  fraction, beside the whole-percent value (0017 then clears that; DESIGN
 *  § Data-converting migrations). Rules: MATCH_RATE_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import {
  PERCENT_MATCH as PERCENT,
  effectiveMatchType,
  rateFromPercent,
} from "../../utils/match-rate";
import {
  isEmpty,
  isRow,
  jsonObject,
  type Row,
  type Update,
} from "./converter-rows";

export const MATCH_RATE_TAG = "0016_v0102_match_rate";

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
        `left without a rate (no number, or too large): ${out.skipped.join(", ")}`,
      );
    return { updates: out.updates, notes };
  },
} as const;
