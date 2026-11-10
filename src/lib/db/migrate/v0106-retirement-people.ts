/** The money tag's per-person retirement rows, live and on restore: a
 *  settings row with no per-person row beside it gets one holding what the
 *  engine read through it. Rules: RETIREMENT_PEOPLE_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { asBool, isEmpty, isRow, type Row } from "./converter-rows";

/** The tag the money converters (this one and the budget and net-pay ones) run under. */
export const MONEY_TAG = "0018_v0106_money";

const PEOPLE_TABLE = "retirement_profile_people";

/** A row's key in a table with a (profile, person) unique index. */
const key = (r: Row) => `${String(r["profile_id"])}:${String(r["person_id"])}`;

const ids = (rows: readonly Row[]) => new Set(rows.map((r) => r["id"]));

/** The four fields the engine read from the settings row, as stored (a
 *  null still reads the household value); no PIA, which only a per-person
 *  row holds, and no raise rate, which is read from the settings row. */
const personRowFrom = (s: Row): Row => ({
  profile_id: s["profile_id"],
  person_id: s["person_id"],
  retirement_age: s["retirement_age"],
  end_age: s["end_age"],
  social_security_monthly: s["social_security_monthly"] ?? null,
  social_security_pia: null,
  ss_start_age: s["ss_start_age"] ?? null,
  rule_of_55_override: asBool(s["rule_of_55_override"]),
  salary_annual_increase: null,
});

// Gated on structure (a pair with a settings row and no per-person row);
// every writer creates both, so a replay adds nothing. A person with neither
// row is left alone: the engine and the planned retirement year disagree.
export const RETIREMENT_PEOPLE_CONVERTER = {
  tables: [
    "people",
    "retirement_profiles",
    "retirement_settings",
    PEOPLE_TABLE,
  ],
  runs: "afterSql",
  rowCounts: { grows: [PEOPLE_TABLE] },
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const people = ids((tables["people"] ?? []).filter(isRow));
    const profiles = ids((tables["retirement_profiles"] ?? []).filter(isRow));
    const held = new Set((tables[PEOPLE_TABLE] ?? []).filter(isRow).map(key));
    const settings = (tables["retirement_settings"] ?? [])
      .filter(isRow)
      .filter(
        (s) =>
          !isEmpty(s["profile_id"]) &&
          profiles.has(s["profile_id"]) &&
          people.has(s["person_id"]),
      )
      .sort((a, b) => Number(a["id"]) - Number(b["id"]));
    const inserts: { table: string; row: Row }[] = [];
    for (const s of settings) {
      if (held.has(key(s))) continue;
      held.add(key(s)); // the first settings row for a pair, as the engine finds it
      inserts.push({ table: PEOPLE_TABLE, row: personRowFrom(s) });
    }
    return {
      updates: [],
      inserts,
      notes: [`${inserts.length} per-person retirement rows added`],
    };
  },
} as const;
