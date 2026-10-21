import * as fs from "fs";
import * as path from "path";

/** Kept equal to src/lib/db/demo-schema-marker.ts (standalone build; a test checks). */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";

function log(
  level: "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>,
) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// BEGIN v0810-profile-sets (keep identical in db-migrate.ts)
type V0810Row = Record<string, unknown>;

/** The rows the v0.8.10 conversion reads and changes, keyed by table name
 *  (snake_case columns, as both a backup and `SELECT *` give them). */
export type V0810Tables = Record<string, V0810Row[] | undefined>;

export type V0810Result = {
  /** Salary Profiles made from older Plans' salaries (ids already set). */
  newSalaryProfiles: V0810Row[];
  /** Ids of rows changed in place, per table. */
  changed: {
    salary_profiles: Set<number>;
    contribution_profiles: Set<number>;
    scenarios: Set<number>;
  };
  /** app_settings keys to delete. */
  deletedSettings: string[];
  /** What was converted, for the log. */
  notes: string[];
};

/** A JSON column as an object: a backup or PostgreSQL gives the value,
 *  SQLite gives text. Anything unreadable is null. */
function v0810Json(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function v0810Object(value: unknown): Record<string, unknown> | null {
  const v = v0810Json(value);
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function v0810Truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Convert v0.8.9-and-older profile data to the v0.8.10 shapes, in place:
 *
 * 1. A Plan's stored salaries (`scenarios.overrides.people[personId].salary`)
 *    become a new Salary Profile — a copy of the Plan's own (or else the
 *    active) Salary Profile with those salaries on each person's current
 *    job — and the Plan uses it.
 * 2. Where each person's bonus goes (the `bonus_destinations` setting)
 *    moves into every Salary Profile entry for that person's jobs
 *    (`bonusDestination`, only when "spending"); the setting is deleted.
 * 3. The Salary Profile's bonus switches (`include401kInBonus` /
 *    `includeBonusInContributions`) become each payroll account's own
 *    `fromBonus` in every Contribution Profile that has an entry for it —
 *    read from the active Salary Profile's entry for the account's job,
 *    else the first profile that has one — and are removed from entries.
 * 4. Duplicate Plan names get " (2)", " (3)", … so the new unique index
 *    can be built.
 *
 * Every step does nothing when its source is gone, so running it twice
 * changes nothing the second time. Only non-default values are written.
 */
export function convertV0810ProfileSets(tables: V0810Tables): V0810Result {
  const result: V0810Result = {
    newSalaryProfiles: [],
    changed: {
      salary_profiles: new Set(),
      contribution_profiles: new Set(),
      scenarios: new Set(),
    },
    deletedSettings: [],
    notes: [],
  };
  const scenarios = tables["scenarios"] ?? [];
  const salaryProfiles = tables["salary_profiles"] ?? [];
  const contributionProfiles = tables["contribution_profiles"] ?? [];
  const accounts = tables["contribution_accounts"] ?? [];
  const jobs = tables["jobs"] ?? [];
  const settings = tables["app_settings"] ?? [];

  const setting = (key: string) =>
    v0810Json(settings.find((s) => s["key"] === key)?.["value"]);
  const byId = (rows: V0810Row[]) =>
    [...rows].sort((a, b) => Number(a["id"]) - Number(b["id"]));

  // Each profile's salaries, parsed once and written back at the end.
  const salariesOf = new Map<V0810Row, Record<string, V0810Row>>();
  for (const p of salaryProfiles) {
    const s = v0810Object(p["salaries"]) as Record<string, V0810Row> | null;
    salariesOf.set(p, s ?? {});
  }
  const activeSalaryId = Number(setting("active_salary_profile_id"));
  const activeSalary =
    salaryProfiles.find((p) => Number(p["id"]) === activeSalaryId) ??
    byId(salaryProfiles)[0];
  const jobById = new Map(jobs.map((j) => [Number(j["id"]), j]));
  const currentJob = (personId: number) =>
    byId(jobs).find(
      (j) =>
        Number(j["person_id"]) === personId &&
        !j["end_date"] &&
        !v0810Truthy(j["is_speculative"]),
    );

  // 1. Plan salaries → their own Salary Profile.
  const takenProfileNames = new Set(salaryProfiles.map((p) => p["name"]));
  let nextProfileId =
    Math.max(0, ...salaryProfiles.map((p) => Number(p["id"]) || 0)) + 1;
  for (const plan of byId(scenarios)) {
    const people = v0810Object(v0810Object(plan["overrides"])?.["people"]);
    if (!people) continue;
    const base =
      salaryProfiles.find(
        (p) => Number(p["id"]) === Number(plan["salary_profile_id"]),
      ) ?? activeSalary;
    if (!base) continue;
    const salaries: Record<string, V0810Row> = JSON.parse(
      JSON.stringify(salariesOf.get(base) ?? {}),
    );
    let changed = false;
    for (const [personId, fields] of Object.entries(people)) {
      const salary = Number(v0810Object(fields)?.["salary"]);
      if (!Number.isFinite(salary)) continue;
      const job = currentJob(Number(personId));
      const current = jobs.filter(
        (j) =>
          Number(j["person_id"]) === Number(personId) &&
          !j["end_date"] &&
          !v0810Truthy(j["is_speculative"]),
      );
      if (current.length > 1)
        result.notes.push(
          `Plan ${plan["id"]}: person ${personId} has ${current.length} current jobs; their stored salary went to job ${job?.["id"]}`,
        );
      const entry = job ? salaries[String(job["id"])] : undefined;
      if (!entry) {
        result.notes.push(
          `Plan ${plan["id"]}: person ${personId} has no current job in its Salary Profile; their stored salary was not kept`,
        );
        continue;
      }
      // Same as the profile already says: nothing to keep.
      if (Number(entry["salary"]) === salary) continue;
      entry["salary"] = salary;
      changed = true;
    }
    if (!changed) continue;
    let name = `${String(plan["name"])} salary`;
    for (let n = 2; takenProfileNames.has(name); n++)
      name = `${String(plan["name"])} salary (${n})`;
    takenProfileNames.add(name);
    const profile: V0810Row = {
      id: nextProfileId++,
      name,
      description: `Made from Plan "${String(plan["name"])}" when upgrading to v0.8.10.`,
      salaries,
      // A restored backup inserts every column its rows carry.
      ...("created_at" in base ? { created_at: base["created_at"] } : {}),
    };
    result.newSalaryProfiles.push(profile);
    salariesOf.set(profile, salaries);
    plan["salary_profile_id"] = profile["id"];
    result.changed.scenarios.add(Number(plan["id"]));
    result.notes.push(
      `Plan ${plan["id"]}: its salaries became Salary Profile "${name}"`,
    );
  }
  const allSalaryProfiles = [...salaryProfiles, ...result.newSalaryProfiles];

  // 2. Bonus destinations → Salary Profile entries.
  const destinations = v0810Object(setting("bonus_destinations"));
  if (destinations) {
    for (const p of salaryProfiles) {
      for (const [jobId, entry] of Object.entries(salariesOf.get(p)!)) {
        const personId = jobById.get(Number(jobId))?.["person_id"];
        if (
          destinations[String(personId)] === "spending" &&
          entry["bonusDestination"] !== "spending"
        ) {
          entry["bonusDestination"] = "spending";
          result.changed.salary_profiles.add(Number(p["id"]));
        }
      }
    }
    for (const p of result.newSalaryProfiles) {
      for (const [jobId, entry] of Object.entries(salariesOf.get(p)!)) {
        const personId = jobById.get(Number(jobId))?.["person_id"];
        if (destinations[String(personId)] === "spending")
          entry["bonusDestination"] = "spending";
      }
    }
  }
  if (settings.some((s) => s["key"] === "bonus_destinations"))
    result.deletedSettings.push("bonus_destinations");

  // 3. Bonus switches → each payroll account's fromBonus.
  const switchOn = (entry: V0810Row | undefined) =>
    entry === undefined
      ? undefined
      : v0810Truthy(entry["include401kInBonus"]) ||
        v0810Truthy(entry["includeBonusInContributions"]);
  const payrollJobOf = new Map<number, number>();
  for (const a of accounts) {
    const isPayroll =
      a["is_payroll_deducted"] === null ||
      a["is_payroll_deducted"] === undefined
        ? a["job_id"] !== null && a["job_id"] !== undefined
        : v0810Truthy(a["is_payroll_deducted"]);
    if (!isPayroll) continue;
    const jobId =
      a["job_id"] !== null && a["job_id"] !== undefined
        ? Number(a["job_id"])
        : Number(currentJob(Number(a["person_id"]))?.["id"]);
    if (Number.isFinite(jobId)) payrollJobOf.set(Number(a["id"]), jobId);
  }
  // Which Salary Profile's switch each Contribution Profile follows: the one
  // its Plans pair it with (when they all agree on one), else the active
  // one, else the oldest.
  const pairedSalary = (contributionProfileId: number) => {
    const ids = new Set(
      scenarios
        .filter(
          (plan) =>
            Number(plan["contribution_profile_id"]) === contributionProfileId,
        )
        .map((plan) => plan["salary_profile_id"])
        .filter((id) => id !== null && id !== undefined)
        .map(Number),
    );
    return ids.size === 1
      ? allSalaryProfiles.find((p) => Number(p["id"]) === [...ids][0])
      : undefined;
  };
  for (const cp of contributionProfiles) {
    const fields = v0810Object(cp["contribution_active_fields"]);
    const perAccount = v0810Object(fields?.["contributionAccounts"]);
    if (!fields || !perAccount) continue;
    const paired = pairedSalary(Number(cp["id"]));
    const ordered = [
      ...(paired ? [paired] : []),
      ...(activeSalary && activeSalary !== paired ? [activeSalary] : []),
      ...byId(salaryProfiles).filter((p) => p !== activeSalary && p !== paired),
    ];
    let changed = false;
    for (const [accountId, jobId] of payrollJobOf) {
      const entry = v0810Object(perAccount[String(accountId)]);
      if (!entry) continue;
      const sources = ordered
        .map((p) => ({ p, on: switchOn(salariesOf.get(p)![String(jobId)]) }))
        .filter((v): v is { p: V0810Row; on: boolean } => v.on !== undefined);
      const first = sources[0];
      if (!first) continue;
      if (sources.some((v) => v.on !== first.on))
        result.notes.push(
          `Contribution Profile ${cp["id"]}, account ${accountId}: Salary Profiles disagreed on taking contributions from bonus checks; used ${first.on ? "yes" : "no"} from Salary Profile "${String(first.p["name"])}"`,
        );
      if (!first.on || entry["fromBonus"] === true) continue;
      perAccount[String(accountId)] = { ...entry, fromBonus: true };
      changed = true;
    }
    if (!changed) continue;
    cp["contribution_active_fields"] = {
      ...fields,
      contributionAccounts: perAccount,
    };
    result.changed.contribution_profiles.add(Number(cp["id"]));
  }
  for (const p of allSalaryProfiles) {
    for (const entry of Object.values(salariesOf.get(p)!)) {
      if (
        "include401kInBonus" in entry ||
        "includeBonusInContributions" in entry
      ) {
        delete entry["include401kInBonus"];
        delete entry["includeBonusInContributions"];
        if (!result.newSalaryProfiles.includes(p))
          result.changed.salary_profiles.add(Number(p["id"]));
      }
    }
  }
  for (const p of salaryProfiles)
    if (result.changed.salary_profiles.has(Number(p["id"])))
      p["salaries"] = salariesOf.get(p);

  // Budget columns no longer have profiles of their own (0009 drops them):
  // note each Budget profile whose columns had one.
  for (const bp of tables["budget_profiles"] ?? []) {
    const ids = [
      v0810Json(bp["column_contribution_profile_ids"]),
      v0810Json(bp["column_salary_profile_ids"]),
    ].flatMap((v) => (Array.isArray(v) ? v : []));
    if (ids.some((id) => id !== null && id !== undefined))
      result.notes.push(
        `Budget profile ${bp["id"]}: its columns' own profiles are gone; every column now uses the active Salary and Contribution profiles`,
      );
  }

  // 4. Unique Plan names.
  // A new name must be free of every Plan's name, not just the ones before.
  const allPlanNames = new Set(scenarios.map((p) => String(p["name"])));
  const takenPlanNames = new Set<string>();
  for (const plan of byId(scenarios)) {
    const base = String(plan["name"]);
    let name = base;
    if (takenPlanNames.has(name)) {
      let n = 2;
      while (
        takenPlanNames.has(`${base} (${n})`) ||
        allPlanNames.has(`${base} (${n})`)
      )
        n++;
      name = `${base} (${n})`;
    }
    if (name !== base) {
      plan["name"] = name;
      result.changed.scenarios.add(Number(plan["id"]));
      result.notes.push(`Plan ${plan["id"]}: renamed to "${name}"`);
    }
    takenPlanNames.add(name);
  }
  return result;
}
// END v0810-profile-sets

/** The tables convertV0810ProfileSets reads. */
const V0810_TABLES = [
  "scenarios",
  "salary_profiles",
  "contribution_profiles",
  "contribution_accounts",
  "jobs",
  "app_settings",
  "budget_profiles",
] as const;

/** Migration 0009's tag — its data conversion runs just before its SQL. */
export const V0810_TAG = "0009_v0810_profile_sets";

/**
 * Run the v0.8.10 data conversion on a PostgreSQL database, inside the
 * caller's transaction (before 0009's statements drop the columns it reads).
 * A table that doesn't exist is skipped.
 */
async function applyV0810ProfileSetsPg(client: {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<void> {
  const tables: V0810Tables = {};
  for (const table of V0810_TABLES) {
    await client.query("SAVEPOINT v0810_read");
    try {
      tables[table] = (await client.query(`SELECT * FROM "${table}"`)).rows;
      await client.query("RELEASE SAVEPOINT v0810_read");
    } catch (err) {
      if ((err as { code?: string }).code !== "42P01") throw err;
      await client.query("ROLLBACK TO SAVEPOINT v0810_read");
    }
  }
  const r = convertV0810ProfileSets(tables);
  for (const p of r.newSalaryProfiles)
    await client.query(
      "INSERT INTO salary_profiles (id, name, description, salaries) VALUES ($1, $2, $3, $4::jsonb)",
      [p["id"], p["name"], p["description"], JSON.stringify(p["salaries"])],
    );
  if (r.newSalaryProfiles.length > 0)
    await client.query(
      "SELECT setval(pg_get_serial_sequence('salary_profiles', 'id'), (SELECT MAX(id) FROM salary_profiles))",
    );
  for (const p of tables["salary_profiles"] ?? [])
    if (r.changed.salary_profiles.has(Number(p["id"])))
      await client.query(
        "UPDATE salary_profiles SET salaries = $1::jsonb WHERE id = $2",
        [JSON.stringify(p["salaries"]), p["id"]],
      );
  for (const p of tables["contribution_profiles"] ?? [])
    if (r.changed.contribution_profiles.has(Number(p["id"])))
      await client.query(
        "UPDATE contribution_profiles SET contribution_active_fields = $1::jsonb WHERE id = $2",
        [JSON.stringify(p["contribution_active_fields"]), p["id"]],
      );
  for (const p of tables["scenarios"] ?? [])
    if (r.changed.scenarios.has(Number(p["id"])))
      await client.query(
        "UPDATE scenarios SET name = $1, salary_profile_id = $2 WHERE id = $3",
        [p["name"], p["salary_profile_id"], p["id"]],
      );
  for (const key of r.deletedSettings)
    await client.query("DELETE FROM app_settings WHERE key = $1", [key]);
  for (const note of r.notes) log("info", "v0810_conversion", { note });
}

/** 0009 builds a unique index on Plan names. The replay loops swallow a
 *  unique violation (23505), so make sure the index really exists. */
async function assertV0810IndexPg(client: {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  const { rows } = await client.query(
    "SELECT 1 FROM pg_indexes WHERE indexname = 'scenarios_name_unique'",
  );
  if (rows.length === 0)
    throw new Error(
      "Migration 0009: the unique index on Plan names wasn't created — two Plans still share a name.",
    );
}

/** The SQLite twin of applyV0810ProfileSetsPg (JSON columns are text). */
export function applyV0810ProfileSetsSqlite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): void {
  const tables: V0810Tables = {};
  for (const table of V0810_TABLES) {
    try {
      tables[table] = sqlite
        .prepare(`SELECT * FROM "${table}"`)
        .all() as Record<string, unknown>[];
    } catch (err) {
      if (!String((err as Error).message).includes("no such table")) throw err;
    }
  }
  const r = convertV0810ProfileSets(tables);
  for (const p of r.newSalaryProfiles)
    sqlite
      .prepare(
        "INSERT INTO salary_profiles (id, name, description, salaries) VALUES (?, ?, ?, ?)",
      )
      .run(p["id"], p["name"], p["description"], JSON.stringify(p["salaries"]));
  for (const p of tables["salary_profiles"] ?? [])
    if (r.changed.salary_profiles.has(Number(p["id"])))
      sqlite
        .prepare("UPDATE salary_profiles SET salaries = ? WHERE id = ?")
        .run(JSON.stringify(p["salaries"]), p["id"]);
  for (const p of tables["contribution_profiles"] ?? [])
    if (r.changed.contribution_profiles.has(Number(p["id"])))
      sqlite
        .prepare(
          "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE id = ?",
        )
        .run(JSON.stringify(p["contribution_active_fields"]), p["id"]);
  for (const p of tables["scenarios"] ?? [])
    if (r.changed.scenarios.has(Number(p["id"])))
      sqlite
        .prepare(
          "UPDATE scenarios SET name = ?, salary_profile_id = ? WHERE id = ?",
        )
        .run(p["name"], p["salary_profile_id"], p["id"]);
  for (const key of r.deletedSettings)
    sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  for (const note of r.notes) log("info", "v0810_conversion", { note });
}

function getDialect(): "postgresql" | "sqlite" {
  const url = process.env.DATABASE_URL;
  if (
    url &&
    (url.startsWith("postgres://") || url.startsWith("postgresql://"))
  ) {
    return "postgresql";
  }
  return "sqlite";
}

/**
 * Reference-data reconcile (R43).
 *
 * `seed-reference-data.sql` is `INSERT … ON CONFLICT DO NOTHING`, plus a
 * trailing corrections section of `UPDATE … WHERE value = <old>` statements
 * — no DDL, no DELETE. It is safe to re-run on every migrate, and doing so
 * is the only way a new tax year added to the seed reaches an existing
 * install. Previously the seed ran only when `contribution_limits` was empty,
 * so annual figure updates never propagated to a populated DB (R43 audit,
 * systemic problem #3).
 *
 * `ON CONFLICT DO NOTHING` never overwrites an admin's Settings edit. A
 * seed-value *correction* goes in the seed's corrections section as an
 * UPDATE guarded by the exact old value (CAST so it compares numerically
 * in SQLite too), so it only ever replaces a row
 * still holding the wrong figure (never an admin's edit).
 *
 * Every table the seed writes MUST be a year-keyed reference table with a
 * `tax_year`-scoped unique constraint. Without one, `ON CONFLICT DO NOTHING`
 * has nothing to conflict on and every reconcile re-inserts duplicate rows.
 * Two guards enforce this before the seed runs, both failing the migrate
 * loudly:
 *   1. Every `INSERT INTO` target must be in `REFERENCE_SEED_TABLES` — an
 *      explicit allowlist, so adding a non-year-keyed `INSERT` to the seed
 *      file surfaces as a clear "this reconcile only handles year-keyed
 *      reference tables" error rather than a cryptic constraint failure or
 *      silent row duplication.
 *   2. Each of those tables is checked for a `tax_year`-scoped unique index
 *      in the live schema (belt-and-braces against the allowlist drifting
 *      from reality).
 * If you need to seed non-year-keyed reference data, do it through a
 * separate mechanism — not this file.
 */
const REFERENCE_SEED_TABLES = new Set([
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
]);

function parseSeedTableNames(seedSql: string): string[] {
  const names = new Set<string>();
  const re = /INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seedSql)) !== null) names.add(m[1]!);
  const unexpected = [...names].filter((n) => !REFERENCE_SEED_TABLES.has(n));
  if (unexpected.length > 0) {
    throw new Error(
      `seed-reference-data.sql inserts into non-reference table(s) [${unexpected.join(
        ", ",
      )}]. The migrate reconcile only handles year-keyed reference tables ` +
        `(${[...REFERENCE_SEED_TABLES].join(", ")}) — add the table to ` +
        `REFERENCE_SEED_TABLES in db-migrate.ts only if it has a tax_year-scoped ` +
        `unique index, otherwise seed it through a separate mechanism.`,
    );
  }
  return [...names];
}

// Table names that are included in versioned backups (must match version-tables.ts).
// This is a local copy because db-migrate.ts runs in Docker where src/ isn't available.
// R43 follow-up (schema-reviewer suggestion): "retirement_profiles" and
// "retirement_profile_people" were missing from this mirror entirely — a
// pre-existing gap, not introduced by R43, found while reviewing the table
// R43's own tax_params_year column lives on. Order within this array is not
// load-bearing (both use sites just dump each table's rows into a JSON
// snapshot independently, read-only, no FK-insert-order constraint) —
// unlike version-tables.ts's VERSION_TABLES, which does encode tier order
// for restore.
const VERSION_TABLE_NAMES = [
  "people",
  "budget_profiles",
  "savings_goals",
  "mortgage_loans",
  "contribution_limits",
  "retirement_scenarios",
  "return_rate_table",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
  "api_connections",
  "app_settings",
  "local_admins",
  "salary_profiles",
  "contribution_profiles",
  "retirement_profiles",
  "scenarios",
  "asset_class_params",
  "mc_presets",
  "portfolio_snapshots",
  "brokerage_goals",
  "net_worth_annual",
  "home_improvement_items",
  "other_asset_items",
  "historical_notes",
  "relocation_scenarios",
  "jobs",
  "historical_salaries",
  "budget_items",
  "savings_monthly",
  "savings_planned_transactions",
  "savings_planned_tx_settlements",
  "savings_allocation_overrides",
  "savings_goal_profile_allocations",
  "self_loans",
  "performance_accounts",
  "mortgage_what_if_scenarios",
  "mortgage_extra_payments",
  "retirement_settings",
  "retirement_profile_people",
  "retirement_salary_overrides",
  "retirement_budget_overrides",
  "asset_class_correlations",
  "asset_class_buckets",
  "glide_path_allocations",
  "brokerage_planned_transactions",
  "annual_performance",
  "property_taxes",
  "paycheck_deductions",
  "contribution_accounts",
  "portfolio_accounts",
  "account_performance",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
  "projection_overrides",
  "mc_user_presets",
  "budget_income_adjustments",
  "account_basis",
  "budget_item_category_links",
  "savings_goal_category_links",
  "simplefin_balance_snapshots",
  "simplefin_accounts",
  "utility_service",
  "utility_reading",
  // v0.8.5 investments foundation
  "securities",
  "simplefin_account_balances",
  "holding_observations",
  "investment_transactions",
  "security_facts",
  // v0.8.8 holding history
  "holding_periods",
  "holding_period_weights",
  "paycheck_earnings",
];

// ---------------------------------------------------------------------------
// Squash upgrade detection + backup (PostgreSQL)
// ---------------------------------------------------------------------------

type SquashResult = {
  backupPath: string | null;
  schemaVersion: string | null;
  wasSquash: boolean;
};

// sha256 of each per-release squashed-baseline migration file, as it existed
// while that release line was current. On any post-squash install, the
// EARLIEST row in __drizzle_migrations is exactly this baseline — an exact,
// unambiguous era signal. A pure schema-shape probe CANNOT distinguish, e.g.,
// a v0.7.0 install from a v0.6.8 one: the v7 squashed baseline *is* the v0.6.8
// schema tip, so no table or column exists in one and not the other.
const BASELINE_HASHES: Record<string, string> = {
  "952dea4c31cf5524148c004239222928a754785719f49651e2b83784d474a22b":
    "v0.7_final",
  "08f641ca8ae0681a1e836dab77b0421bbb6949d68ac04d115b1f58539e32a3d0":
    "v0.6_final",
};

// sha256 of every PostgreSQL migration file of the v0.8 line, including the
// pre-release 0004–0011 that v0.8.5 squashed into one. Add each new
// migration here when it ships. The LATEST applied row names exactly where an install was, so a
// backup taken before the squash is labelled with its real schema tag
// (all are in backup-transforms' V08_SCHEMA_TAGS).
const V08_MIGRATION_HASHES: Record<string, string> = {
  a626ffc04645cdc4d3a28b0793d380796c27be18d954ba22b62514018d595d5f:
    "0000_v8_initial_schema",
  fcdc386e4feec343e36bf406408b945085d25e3ab894400c35380eae6f089db1:
    "0001_nappy_blade",
  "1e41b0bc9dffb0f161e934366d6bca24f7eb760c2a36dfa1089570c8c5a264f7":
    "0002_talented_monster_badoon",
  "3885f68b63400bafa5255385298f696ac03762bde8d62f63d10eafdfd87ab59d":
    "0003_past_rhodey",
  "604efb62e506b15c0e4fb1badcd39e8322e6029754caeb07aa655d9883d40995":
    "0004_simple_rogue",
  "0fdbea5668319cde21964cdc4731467be705ca30948d1277d751f0b2600213c2":
    "0005_light_prima",
  bf1ae798460566c4643eaa7513f73346fa19db826e20c822fbb748b2f44caad0:
    "0006_empty_zarda",
  a67207de4f5756238733969d786dd6b3e50425e0cdb7806c709af5c8d723ea6a:
    "0007_bizarre_zarek",
  "20aa1a547298db796e508d3f2a3b89e8e288e8926ea5c44d662831f03efbddb8":
    "0008_worthless_talisman",
  "714af5cf53b1209c1ce826835d770efa3f119848479cd8bb0c0d8d050644af2b":
    "0009_icy_black_cat",
  "540178c73bb2f46266a77e5b57eafab7f90913c3641fe03ab0fb2d1bfecccca0":
    "0010_red_ink",
  "5d38e8c357c954874148fe4052d3dff8a10ca116b2f873fb09a432526c3bb178":
    "0011_lumpy_maximus",
  // v0.8.5 as released (0004–0011 squashed). Keep in step with the file.
  da6dbae6f960a0e17c5d3810ad13a8971de5de1782b171d8249107e3d75ff3a7:
    "0004_v085_investments",
  // v0.8.6: savings_goals parent key + index, old roth_basis names, pending_rollovers dropped.
  b9e85651c61ef84f14d47c010ce6eebd53291b32401381f8445d340924a7886d:
    "0005_v086_schema_cleanup",
  // v0.8.8: holding history tables; legacy account_holdings dropped.
  "410f5133c53ca099b8a7e996a5f490795aeadf37fb76e8a896af234a60387964":
    "0006_v088_holding_periods",
  "18d3b73b7b2f4b5b517acf2bace36352da2177adda54e886e13b407cce3e23e7":
    "0007_v088_drop_account_holdings",
  "557d5cbc5313ee2ca388e2c5d9fbf5c03d3f0794968b4f313778389a987b5a61":
    "0008_v088_paycheck_earnings",
  // v0.8.10: Plans are sets of profiles; per-account fromBonus; unique Plan names.
  "79acc58519aec1a6bbb497fca3bd5691f987ae6f4351b3eca06174db040571e8":
    "0009_v0810_profile_sets",
  // v0.8.10: holding history per part (holding_periods.sub_key).
  "63fc76f959fa22a150d4f8227fe4cdd898f2cc8eee5ecf11a049659dd67ad92d":
    "0010_v0810_holding_period_parts",
};

/**
 * Detect the pre-squash schema era. Hash of the earliest applied migration
 * first (exact for v0.6.x / v0.7.x), then schema-shape probes for older
 * eras that predate the squashed-baseline scheme.
 */
async function detectSchemaEra(
  client: import("pg").PoolClient,
): Promise<string> {
  // Exact, v0.8 line: the latest migration applied.
  try {
    const { rows: lastRow } = await client.query(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1",
    );
    const lastHash = lastRow[0]?.hash as string | undefined;
    if (lastHash && V08_MIGRATION_HASHES[lastHash]) {
      return V08_MIGRATION_HASHES[lastHash];
    }
  } catch {
    // __drizzle_migrations absent or unreadable — fall through.
  }

  // Exact: the first migration a post-squash install ever applied is its
  // release-line baseline.
  try {
    const { rows: firstRow } = await client.query(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id ASC LIMIT 1",
    );
    const firstHash = firstRow[0]?.hash as string | undefined;
    if (firstHash && BASELINE_HASHES[firstHash]) {
      return BASELINE_HASHES[firstHash];
    }
  } catch {
    // __drizzle_migrations absent or unreadable — fall through to probes.
  }

  // Heuristic fallback for older eras (these installs are years old and rare;
  // their probes have never been exact but the cumulative backup-transform
  // ladder tolerates an over-conservative guess).

  // A v0.8.5+ install (has `securities`) whose migration rows can't be
  // matched: label it v0.8.5 rather than letting it fall through — since
  // 0007 dropped account_holdings, it would otherwise read as v0.5.
  const { rows: probeV085 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'securities'
    ) AS exists`,
  );
  if (probeV085[0]?.exists) return "0004_v085_investments";

  // v0.6.x install whose __drizzle_migrations lacks the baseline row:
  // account_holdings is in the v6 baseline itself.
  const { rows: probeV06 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'account_holdings'
    ) AS exists`,
  );
  if (probeV06[0]?.exists) return "v0.6_final";

  // v0.5.x has is_immutable on annual_performance (added in 0001_v5_schema_changes)
  const { rows: probeV05 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'annual_performance' AND column_name = 'is_immutable'
    ) AS exists`,
  );
  if (probeV05[0]?.exists) return "v0.5_final";

  // v0.3.x has projection_overrides table (added in v0.3.23)
  const { rows: probeV03 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projection_overrides'
    ) AS exists`,
  );
  if (probeV03[0]?.exists) return "v0.3_final";

  // v0.2.x has is_api_sync_enabled on savings_goals (renamed in v0.2.0)
  const { rows: probeV02 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'savings_goals' AND column_name = 'is_api_sync_enabled'
    ) AS exists`,
  );
  if (probeV02[0]?.exists) return "v0.2_final";

  // v0.1.x — use the last v0.1.x tag
  return "0008_prior_year_contrib";
}

/**
 * First directory that actually accepts a write, from an ordered candidate
 * list. The pre-upgrade backup is the safety net before a destructive
 * squash / DROP, so "the directory exists" (the old `fs.existsSync`
 * heuristic) is not enough — on the hardened homelab stack the container
 * rootfs is read-only and `/app/data` is present but not a writable mount,
 * so `writeFileSync` there throws EROFS and the backup silently never
 * happened (R18).
 *
 *  1. `LEDGR_BACKUP_DIR` — point this at a writable volume mount in the
 *     deployment (the fix for a read-only-rootfs container).
 *  2. `/app/data` — the historical location; works when it IS a writable
 *     mount.
 *  3. `/tmp` — last resort that still beats no backup: it survives the
 *     migration run (long enough for an operator to copy the file out),
 *     just not a container restart. Usually a tmpfs even on a read-only
 *     rootfs.
 *  4. `.` — local/dev.
 *
 * Returns `null` only when every candidate rejects a probe write — a
 * genuinely unwritable environment, which the callers log at error level.
 */
function resolveWritableBackupDir(): string | null {
  const candidates = [
    process.env.LEDGR_BACKUP_DIR,
    "/app/data",
    "/tmp",
    ".",
  ].filter((d): d is string => !!d && d.trim().length > 0);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.pre-upgrade-backup-probe-${process.pid}`);
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // not writable — try the next candidate
    }
  }
  return null;
}

/** How many pre-upgrade backups to keep in the backup directory (newest first). */
const PRE_UPGRADE_BACKUPS_KEPT = 5;

/** Keep only the newest pre-upgrade backups — restart loops would otherwise pile them up. */
export function prunePreUpgradeBackups(backupDir: string): void {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => /^pre-upgrade-backup-.*\.(json|db)$/.test(f))
      .sort()
      .reverse();
    for (const f of files.slice(PRE_UPGRADE_BACKUPS_KEPT)) {
      fs.unlinkSync(path.join(backupDir, f));
      log("info", "pre_upgrade_backup_pruned", { file: f });
    }
  } catch (err) {
    log("warn", "pre_upgrade_backup_prune_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Warn when a backup landed somewhere a container rebuild would erase. */
function warnIfEphemeral(backupPath: string): void {
  if (process.env.LEDGR_BACKUP_DIR || backupPath.startsWith("/app/data/"))
    return;
  log("error", "pre_upgrade_backup_not_persistent", {
    path: backupPath,
    message:
      "The pre-upgrade backup was written outside a persistent volume and will be lost when the container is recreated. Copy it out now, and set LEDGR_BACKUP_DIR to a mounted directory.",
  });
}

/**
 * Export a JSON snapshot of every VERSION_TABLE_NAMES table and write it to
 * disk — the safety net before any schema change (squash or normal
 * upgrade). Same "pre-upgrade-backup-*.json" format from every call site.
 *
 * Read in one REPEATABLE READ, READ ONLY transaction so all tables come
 * from the same moment. Only a table that doesn't exist yet (added by the
 * migration about to run) is exported empty; any other read error fails
 * the backup rather than writing one with silently missing data.
 */
async function writePreMigrationBackupPg(
  client: import("pg").PoolClient,
  schemaVersion: string,
): Promise<string | null> {
  const tables: Record<string, unknown[]> = {};
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: existing } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const present = new Set(existing.map((r) => r.tablename));
    for (const tableName of VERSION_TABLE_NAMES) {
      if (!present.has(tableName)) {
        tables[tableName] = [];
        continue;
      }
      const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = rows;
    }
    await client.query("COMMIT");
  } catch (readErr) {
    await client.query("ROLLBACK").catch(() => {});
    log("error", "pre_migration_backup_read_failed", {
      error: readErr instanceof Error ? readErr.message : String(readErr),
    });
    return null;
  }

  const backup = {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    preUpgradeBackup: true,
    tables,
  };

  const backupDir = resolveWritableBackupDir();
  if (!backupDir) {
    log("error", "pre_migration_backup_no_writable_dir", {
      message:
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .). Set LEDGR_BACKUP_DIR to a writable volume mount.",
    });
    return null;
  }
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      backupDir,
      `pre-upgrade-backup-${timestamp}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    log("info", "pre_migration_backup_complete", {
      path: backupPath,
      tableCount: Object.keys(tables).length,
      totalRows: Object.values(tables).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    });
    warnIfEphemeral(backupPath);
    prunePreUpgradeBackups(backupDir);
    return backupPath;
  } catch (backupErr) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
    });
    return null;
  }
}

/**
 * Handle a migration squash: when the DB has more applied migrations than the
 * journal has entries, a schema squash has occurred. This function:
 * 1. Creates a pre-upgrade backup
 * 2. Clears the old __drizzle_migrations entries
 * 3. Applies the new squashed migration idempotently (savepoints + ignore duplicates)
 * 4. Records the new migration hash
 *
 * After this, Drizzle's migrate() sees all migrations as applied and is a no-op.
 */
async function handleSquashUpgrade(
  pool: import("pg").Pool,
  migrationsFolder: string,
  journalPath: string,
): Promise<SquashResult> {
  const client = await pool.connect();
  // Hoisted out of the try block (rather than declared where it's first
  // assigned below) so the catch block can report whether a backup was
  // already written to disk before whatever failed — see the catch block.
  let backupPathBeforeFailure: string | null = null;
  try {
    // Drizzle ORM stores migrations in the "drizzle" schema.
    // Check if drizzle.__drizzle_migrations table exists.
    const { rows: tableCheck } = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const { rows: migrationRows } = await client.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount = migrationRows[0]?.count ?? 0;

    const journal = JSON.parse(
      fs.readFileSync(path.resolve(journalPath), "utf-8"),
    );
    const journalCount = journal.entries?.length ?? 0;

    // Squash detection. Three cases trigger recovery:
    //   1. appliedCount > journalCount — old logic, catches the common case
    //      where a squash collapses N migrations into M < N entries.
    //   2. appliedCount == 0 with existing application tables — partial
    //      recovery from a previous failed squash that cleared the journal.
    //   3. HASH mismatch — appliedCount equals journalCount but the DB's
    //      applied hashes don't match the journal's expected hashes. Happens
    //      when a v0.5-style squash produces the same number of journal
    //      entries as the previous version, but the file contents (and
    //      therefore hashes) changed. Without this, drizzle.migrate() would
    //      attempt to apply the new migrations from scratch and fail on
    //      duplicate-table errors.
    let isPartialRecovery = false;
    let needsRecovery = appliedCount > journalCount;
    if (!needsRecovery) {
      if (appliedCount === 0) {
        // Check if any application tables exist (partial squash recovery)
        const { rows: tableProbe } = await client.query(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'people'
          ) AS exists`,
        );
        if (tableProbe[0]?.exists) {
          isPartialRecovery = true;
          needsRecovery = true;
          log("info", "partial_squash_recovery_detected", {
            reason:
              "Migration journal empty but application tables exist — recovering from failed squash",
          });
        }
      } else if (journalCount > 0) {
        // Hash-mismatch detection.
        // Only check the first `appliedCount` journal entries — entries beyond
        // appliedCount are legitimately new (not yet applied) and should NOT
        // trigger squash recovery; they go through the normal migrate() path.
        const cryptoMod = await import("crypto");
        const { rows: appliedRows } = await client.query<{ hash: string }>(
          "SELECT hash FROM drizzle.__drizzle_migrations",
        );
        const appliedHashes = new Set(appliedRows.map((r) => r.hash));
        for (const entry of journal.entries.slice(0, appliedCount)) {
          const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
          if (!fs.existsSync(sqlPath)) continue;
          const sql = fs.readFileSync(sqlPath, "utf-8");
          const expected = cryptoMod
            .createHash("sha256")
            .update(sql)
            .digest("hex");
          if (!appliedHashes.has(expected)) {
            needsRecovery = true;
            break;
          }
        }
      }
    }
    if (!needsRecovery) {
      return { backupPath: null, schemaVersion: null, wasSquash: false };
    }

    // --- Squash detected (or partial recovery) ---
    const schemaVersion = await detectSchemaEra(client);
    log("info", "squash_upgrade_start", {
      appliedMigrations: appliedCount,
      journalMigrations: journalCount,
      schemaVersion,
    });

    // 1. Export backup + clear journal (skip for partial recovery — already empty)
    let backupPath: string | null = null;
    if (!isPartialRecovery) {
      backupPath = await writePreMigrationBackupPg(client, schemaVersion);
      backupPathBeforeFailure = backupPath;
      // Clearing the journal below is the most destructive step — never
      // without a backup.
      requireBackupOrAbort(backupPath);

      // 2. Clear old migration journal
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      log("info", "migration_journal_cleared", {
        removedEntries: appliedCount,
      });
    }

    // 3. Apply each new journal migration idempotently and record its hash
    const crypto = await import("crypto");
    // "Already done" AND "already moved past" are both benign here — this
    // loop blindly replays potentially-ancient migrations against a DB that
    // may already be arbitrarily far beyond them. A migration that creates
    // something that already exists (duplicate_*) is exactly as expected as
    // one that references a column/table a LATER migration already
    // renamed or dropped (undefined_column/undefined_table) — e.g. 0005's
    // `INSERT ... SELECT bonus_override FROM jobs` + `DROP COLUMN
    // bonus_override`, replayed after some later migration already dropped
    // that column for real. Without these two codes, a replay that reaches
    // exactly this kind of statement hard-fails mid-loop, after the journal
    // has already been cleared and earlier entries already committed —
    // leaving __drizzle_migrations in a half-recovered state that requires
    // manual repair (see .scratch/recover-migration-tracking.mjs for the
    // one-off recovery this caused on the dev DB on 2026-08-18).
    const IGNORABLE_PG_CODES = new Set([
      "42701", // duplicate_column
      "42P07", // duplicate_table
      "42710", // duplicate_object (index, constraint, etc.)
      "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
      "23505", // unique_violation
      "42703", // undefined_column — already renamed/dropped by a later migration
      "42P01", // undefined_table — already renamed/dropped by a later migration
    ]);

    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");

      // The only per-tag data step is 0009's (V0810_TAG): it runs inside the
      // migration's transaction, before the statements drop what it reads.

      const statements = sql
        .split("--> statement-breakpoint")
        .map((s: string) => s.trim())
        .filter(Boolean);

      await client.query("BEGIN");
      try {
        // v0.8.10 data conversion, before 0009 drops what it reads.
        if (entry.tag === V0810_TAG) await applyV0810ProfileSetsPg(client);
        for (const stmt of statements) {
          await client.query("SAVEPOINT squash_stmt");
          try {
            await client.query(stmt);
            await client.query("RELEASE SAVEPOINT squash_stmt");
          } catch (stmtErr) {
            const code = (stmtErr as { code?: string }).code;
            if (code && IGNORABLE_PG_CODES.has(code)) {
              await client.query("ROLLBACK TO SAVEPOINT squash_stmt");
            } else {
              throw stmtErr;
            }
          }
        }
        if (entry.tag === V0810_TAG) await assertV0810IndexPg(client);
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [hash, String(Date.now())],
        );
        await client.query("COMMIT");
        log("info", "squash_migration_applied", { tag: entry.tag });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      }
    }

    // 4. v0.1.x → v0.4: rename boolean columns that changed in v0.2.0
    if (schemaVersion === "0008_prior_year_contrib") {
      const renames = [
        {
          table: "savings_goals",
          from: "api_sync_enabled",
          to: "is_api_sync_enabled",
        },
        {
          table: "retirement_scenarios",
          from: "lt_brokerage_enabled",
          to: "is_lt_brokerage_enabled",
        },
      ];
      for (const { table, from, to } of renames) {
        try {
          const { rows } = await client.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            [table, from],
          );
          if (rows.length > 0) {
            await client.query(
              `ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`,
            );
            log("info", "column_renamed", { table, from, to });
          }
        } catch (renameErr) {
          log("warn", "column_rename_skipped", {
            table,
            from,
            to,
            error:
              renameErr instanceof Error
                ? renameErr.message
                : String(renameErr),
          });
        }
      }
    }

    log("info", "squash_upgrade_complete", { schemaVersion });
    return { backupPath, schemaVersion, wasSquash: true };
  } catch (err) {
    // A missing backup stops everything — never swallowed like other
    // squash failures below.
    if (err instanceof BackupRequiredError) throw err;
    // A backup written before the failure is real, on-disk pre-upgrade
    // state — say so explicitly. Without this, the swallow-and-continue
    // behavior below (unchanged: callers proceed as if no squash happened)
    // gives an operator no signal that a usable backup already exists, even
    // though one may be sitting right there.
    log("warn", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      ...(backupPathBeforeFailure
        ? {
            message: `backup written to ${backupPathBeforeFailure} before failure — see it for pre-upgrade state`,
            backupPath: backupPathBeforeFailure,
          }
        : {}),
    });
    return { backupPath: null, schemaVersion: null, wasSquash: false };
  } finally {
    client.release();
  }
}

/**
 * Journal entries whose migration file hash isn't recorded yet, and the tag
 * of the last entry that is (the schema the database is at now — the
 * backup's schemaVersion, which restore transforms key on).
 */
export function pendingJournalEntries(
  journal: { entries: { tag: string }[] },
  migrationsFolder: string,
  recordedHashes: Set<string>,
  crypto: typeof import("crypto"),
): { pendingTags: string[]; lastAppliedTag: string | null } {
  const pendingTags: string[] = [];
  let lastAppliedTag: string | null = null;
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(sqlPath, "utf-8"))
      .digest("hex");
    if (recordedHashes.has(hash)) lastAppliedTag = entry.tag;
    else pendingTags.push(entry.tag);
  }
  return { pendingTags, lastAppliedTag };
}

/**
 * Stop before migrating when the pre-migration backup couldn't be written.
 * LEDGR_SKIP_PREMIGRATION_BACKUP=true proceeds anyway (an operator who has
 * their own backup, e.g. a pg_dump or volume snapshot).
 */
/** The pre-migration backup couldn't be written — always stops the migration. */
export class BackupRequiredError extends Error {
  override name = "BackupRequiredError";
}

export function requireBackupOrAbort(backupPath: string | null): void {
  if (backupPath) return;
  if (process.env.LEDGR_SKIP_PREMIGRATION_BACKUP === "true") {
    log("warn", "pre_migration_backup_skipped", {
      message:
        "No pre-migration backup could be written; continuing because LEDGR_SKIP_PREMIGRATION_BACKUP=true.",
    });
    return;
  }
  throw new BackupRequiredError(
    "Refusing to migrate: the pre-migration backup could not be written. The database has not been changed. Set LEDGR_BACKUP_DIR to a writable directory (or LEDGR_SKIP_PREMIGRATION_BACKUP=true if you have your own backup) and restart.",
  );
}

async function runPostgres() {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { Pool } = await import("pg");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    // Handle squash upgrade: if the DB has more applied migrations than the
    // journal, a schema squash occurred.  This creates a backup, clears old
    // journal entries, applies the new squashed migration idempotently, and
    // records its hash — so Drizzle's migrate() below becomes a no-op.
    const squash = await handleSquashUpgrade(
      pool,
      "./drizzle",
      "./drizzle/meta/_journal.json",
    );
    let backupPath = squash.backupPath;

    // Apply any pending migrations idempotently before handing off to Drizzle's
    // migrate(). This handles upgrade DBs that already have tables/columns from
    // old pre-squash migrations — Drizzle's migrator has no savepoint support
    // and would fail on "table already exists" or "column already exists" errors.
    // Running idempotently first means migrate() below is always a no-op.
    const journal = JSON.parse(
      fs.readFileSync(path.resolve("./drizzle/meta/_journal.json"), "utf-8"),
    );
    const preClient = await pool.connect();
    try {
      // Ensure drizzle schema + migrations table exist (migrate() normally does
      // this, but we need it before our idempotent pre-apply step).
      await preClient.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await preClient.query(
        `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );

      const { rows: recorded } = await preClient.query(
        "SELECT hash FROM drizzle.__drizzle_migrations",
      );
      const recordedHashes = new Set(
        recorded.map((r: { hash: string }) => r.hash),
      );
      const crypto = await import("crypto");

      // Back up before changing an existing install's schema — every
      // upgrade, not only squashes. Fresh installs (no app tables yet)
      // have nothing to lose. Refuse to migrate if no backup could be
      // written: the container then fails to start with the database
      // untouched, and the previous image still runs against it.
      const pending = pendingJournalEntries(
        journal,
        "./drizzle",
        recordedHashes,
        crypto,
      );
      if (pending.pendingTags.length > 0 && !backupPath) {
        const { rows: probe } = await preClient.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'people') AS exists`,
        );
        if (probe[0]?.exists) {
          log("info", "pre_migration_backup_start", {
            pending: pending.pendingTags,
            from: pending.lastAppliedTag,
          });
          backupPath = await writePreMigrationBackupPg(
            preClient,
            // The label restore transforms key on — never "unknown", which
            // the import path rejects.
            pending.lastAppliedTag ?? (await detectSchemaEra(preClient)),
          );
          requireBackupOrAbort(backupPath);
        }
      }

      // See the matching comment in handleSquashUpgrade above — this loop
      // has the identical "replay a migration whose hash isn't recorded yet
      // against a DB that may already be past it" shape, so it needs the
      // same undefined_column/undefined_table tolerance.
      const IGNORABLE_PG_CODES = new Set([
        "42701", // duplicate_column
        "42P07", // duplicate_table
        "42710", // duplicate_object (index, constraint, etc.)
        "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
        "23505", // unique_violation
        "42703", // undefined_column — already renamed/dropped by a later migration
        "42P01", // undefined_table — already renamed/dropped by a later migration
      ]);
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const hash = crypto.createHash("sha256").update(sql).digest("hex");
        if (recordedHashes.has(hash)) continue;
        // (The only per-tag data step is 0009's — V0810_TAG below.)
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter(Boolean);
        await preClient.query("BEGIN");
        try {
          // v0.8.10 data conversion, before 0009 drops what it reads.
          if (entry.tag === V0810_TAG) await applyV0810ProfileSetsPg(preClient);
          for (const stmt of statements) {
            await preClient.query("SAVEPOINT apply_stmt");
            try {
              await preClient.query(stmt);
              await preClient.query("RELEASE SAVEPOINT apply_stmt");
            } catch (stmtErr) {
              const code = (stmtErr as { code?: string }).code;
              if (code && IGNORABLE_PG_CODES.has(code)) {
                await preClient.query("ROLLBACK TO SAVEPOINT apply_stmt");
              } else {
                throw stmtErr;
              }
            }
          }
          if (entry.tag === V0810_TAG) await assertV0810IndexPg(preClient);
          await preClient.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [hash, String(Date.now())],
          );
          await preClient.query("COMMIT");
          log("info", "migration_applied", { tag: entry.tag });
        } catch (txErr) {
          await preClient.query("ROLLBACK");
          throw txErr;
        }
      }
    } finally {
      preClient.release();
    }

    // Drizzle's own migrate() — always a no-op after the idempotent pre-apply
    // above, but retained as a safety net for any edge cases.
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });

    log("info", "migrations_applied", { dialect: "postgresql" });

    // Drop stale demo schemas so they get rebuilt fresh from the public
    // schema's current structure on next activation. Demo schemas are
    // sandboxes the demo router (src/server/routers/demo.ts) builds with
    // CREATE TABLE LIKE public.x and stamps with the applied-migration
    // count (src/lib/db/demo-schema-marker.ts); any whose stamp doesn't
    // match the current count was built for an older structure. Checked on
    // EVERY start, not just when a migration ran, so a failed drop is
    // retried — and it's fatal: a stale schema can't be left in place
    // (requests refuse to use it, but it must not linger silently).
    {
      const demoClient = await pool.connect();
      try {
        const { rows: stale } = await demoClient.query<{ nspname: string }>(
          `SELECT n.nspname FROM pg_namespace n
            WHERE n.nspname LIKE 'demo\\_%'
              AND obj_description(n.oid, 'pg_namespace') IS DISTINCT FROM
                  $1 || (SELECT count(*)::int FROM drizzle.__drizzle_migrations)::text
            ORDER BY n.nspname`,
          [DEMO_SCHEMA_MARKER_PREFIX],
        );
        for (const { nspname } of stale) {
          // Quote identifier to defend against schema names with special chars
          const quoted = '"' + nspname.replaceAll('"', '""') + '"';
          await demoClient.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
          log("info", "demo_schema_dropped_for_rebuild", {
            schema: nspname,
            reason:
              "Built for an older schema — demo profile will be rebuilt fresh on next activation",
          });
        }
        if (stale.length > 0) {
          log("info", "demo_schemas_cleared", {
            count: stale.length,
            note: "Users with active demo profiles will need to re-activate via the UI",
          });
        }
      } catch (demoErr) {
        log("error", "demo_schema_cleanup_failed", {
          error: demoErr instanceof Error ? demoErr.message : String(demoErr),
        });
        throw new Error(
          `Couldn't drop stale demo schemas: ${demoErr instanceof Error ? demoErr.message : String(demoErr)}`,
        );
      } finally {
        demoClient.release();
      }
    }

    // Write upgrade banner flag if a pre-migration backup was created
    if (backupPath) {
      const flagClient = await pool.connect();
      try {
        await flagClient.query(
          `INSERT INTO app_settings (key, value)
           VALUES ('pre_upgrade_backup', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [
            JSON.stringify({
              path: backupPath,
              createdAt: new Date().toISOString(),
            }),
          ],
        );
        log("info", "upgrade_banner_flag_set", { path: backupPath });
      } catch (flagErr) {
        log("warn", "upgrade_banner_flag_failed", {
          error: flagErr instanceof Error ? flagErr.message : String(flagErr),
        });
      } finally {
        flagClient.release();
      }
    }

    // Reference-data reconcile (R43): additive, runs on every migrate so a
    // new tax year in the seed reaches existing installs. Fails the migrate
    // loudly on any error — a silently skipped reconcile is the "seed never
    // reaches prod" bug this replaces.
    const seedClient = await pool.connect();
    try {
      const seedSql = fs.readFileSync(
        path.resolve("./seed-reference-data.sql"),
        "utf-8",
      );
      const seedTables = parseSeedTableNames(seedSql);
      for (const table of seedTables) {
        const { rows } = await seedClient.query(
          `SELECT 1
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_attribute a ON a.attrelid = i.indrelid
                                AND a.attnum = ANY(i.indkey)
            WHERE c.relname = $1 AND i.indisunique AND a.attname = 'tax_year'
            LIMIT 1`,
          [table],
        );
        if (rows.length === 0) {
          throw new Error(
            `Reference table "${table}" has no tax_year-scoped unique constraint — ` +
              `seed reconcile would duplicate rows on every migrate. Add a unique index first.`,
          );
        }
      }
      await seedClient.query(seedSql);
      log("info", "reference_data_reconciled", {
        tables: seedTables.join(", "),
      });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * SQLite twin of writePreMigrationBackupPg (see its docblock) — same
 * VERSION_TABLE_NAMES snapshot, same JSON shape, written by the
 * squash-upgrade path.
 */
function writePreMigrationBackupSQLite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
  schemaVersion: string,
): string | null {
  const tables: Record<string, unknown[]> = {};
  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      tables[tableName] = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
    } catch {
      tables[tableName] = [];
    }
  }

  const backup = {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    preUpgradeBackup: true,
    tables,
  };

  const backupDir = resolveWritableBackupDir();
  if (!backupDir) {
    log("error", "pre_migration_backup_no_writable_dir", {
      message:
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .). Migration is proceeding WITHOUT an on-disk safety net — set LEDGR_BACKUP_DIR to a writable volume mount.",
    });
    return null;
  }
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      backupDir,
      `pre-upgrade-backup-${timestamp}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    log("info", "pre_migration_backup_complete", {
      path: backupPath,
      tableCount: Object.keys(tables).length,
      totalRows: Object.values(tables).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    });
    return backupPath;
  } catch (backupErr) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
      message:
        "Pre-upgrade backup write failed after its directory passed a probe. Migration is proceeding WITHOUT an on-disk safety net.",
    });
    return null;
  }
}

/**
 * Handle SQLite squash upgrade: same logic as PG but using better-sqlite3 API.
 * Detects squash, creates backup, clears old journal, applies migration
 * idempotently, and records the hash so Drizzle's migrate() is a no-op.
 */
/**
 * Exact copy of the SQLite database (VACUUM INTO — consistent, includes the
 * migration journal). Restoring = stop Ledgr, put this file in place of the
 * database file, start the previous version.
 */
function writePreMigrationBackupSqlite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): string | null {
  const backupDir = resolveWritableBackupDir();
  if (!backupDir) {
    log("error", "pre_migration_backup_no_writable_dir", {
      message:
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .).",
    });
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `pre-upgrade-backup-${timestamp}.db`);
  try {
    sqlite.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    log("info", "pre_migration_backup_complete", { path: backupPath });
    warnIfEphemeral(backupPath);
    prunePreUpgradeBackups(backupDir);
    return backupPath;
  } catch (err) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function handleSQLiteSquashUpgrade(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
  migrationsFolder: string,
  journalPath: string,
): string | null {
  // Check if __drizzle_migrations table exists
  const tableExists = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get() as { n: number };
  if (!tableExists || tableExists.n === 0) return null;

  const appliedCount = (
    sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    }
  ).n;

  const journal = JSON.parse(
    fs.readFileSync(path.resolve(journalPath), "utf-8"),
  );
  const journalCount = journal.entries?.length ?? 0;

  // Detect squash. Three cases:
  //   1. Count mismatch (appliedCount > journalCount) — old logic, catches the
  //      common case where a squash collapses N migrations into M < N.
  //   2. appliedCount === 0 with existing application tables — partial recovery
  //      from a previous failed squash that cleared the journal but didn't finish.
  //   3. HASH mismatch — appliedCount equals journalCount but the DB's applied
  //      hashes don't match the journal's expected hashes. Happens when the
  //      v4→v5 squash produces the same number of journal entries as the
  //      previous version had, but the file contents (and therefore hashes)
  //      changed. Without this, drizzle.migrate() would attempt to apply the
  //      "new" migrations from scratch and fail on duplicate-table errors.
  let needsSquashRecovery = appliedCount > journalCount;
  if (!needsSquashRecovery) {
    if (appliedCount === 0) {
      // Check if any application tables exist (partial squash recovery).
      // Use the era probes so we can skip the second probe pass below if positive.
      const v07Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='savings_planned_tx_settlements'",
        )
        .get() as { n: number };
      const v06Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='account_holdings'",
        )
        .get() as { n: number };
      const v05Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
        )
        .get() as { n: number };
      const v03Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projection_overrides'",
        )
        .get() as { n: number };
      if (
        v07Check.n > 0 ||
        v06Check.n > 0 ||
        v05Check.n > 0 ||
        v03Check.n > 0
      ) {
        needsSquashRecovery = true;
        log("info", "partial_squash_recovery_detected", {
          reason:
            "Migration journal empty but application tables exist — recovering from failed squash",
        });
      }
    } else if (journalCount > 0) {
      // Only check the first `appliedCount` journal entries for hash mismatch.
      // Entries beyond appliedCount are legitimately new (not yet applied) and
      // should NOT trigger squash recovery — they go through the normal migrate() path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cryptoMod = require("crypto") as typeof import("crypto");
      const appliedHashes = new Set(
        (
          sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
            hash: string;
          }[]
        ).map((r) => r.hash),
      );
      for (const entry of journal.entries.slice(0, appliedCount)) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const expected = cryptoMod
          .createHash("sha256")
          .update(sql)
          .digest("hex");
        if (!appliedHashes.has(expected)) {
          needsSquashRecovery = true;
          break;
        }
      }
    }
  }
  if (!needsSquashRecovery) return null;

  // --- Squash detected ---
  // Detect schema era. The first migration a post-squash install applied is
  // its release-line baseline — an exact signal (a schema-shape probe can't
  // tell a v0.7.0 install from a v0.6.8 one, since the v7 baseline IS the
  // v0.6.8 tip). SQLite baseline files differ from the PG ones, so these
  // hashes are the SQLite spellings.
  const SQLITE_BASELINE_HASHES: Record<string, string> = {
    dc91abbd28dd17fc654c9712fb27ce8f922708ccaaad7a4d68acbc19d8a7c685:
      "v0.7_final",
    d640cf13da448193bc3cd36084a9495bf8f826d3a3df15f0cfe4acfb6776c2d3:
      "v0.6_final",
  };
  let hashEra: string | null = null;
  try {
    const firstRow = sqlite
      .prepare(
        "SELECT hash FROM __drizzle_migrations ORDER BY rowid ASC LIMIT 1",
      )
      .get() as { hash?: string } | undefined;
    if (firstRow?.hash && SQLITE_BASELINE_HASHES[firstRow.hash]) {
      hashEra = SQLITE_BASELINE_HASHES[firstRow.hash] ?? null;
    }
  } catch {
    // fall through to probes
  }

  // Heuristic fallback for older eras / installs missing the baseline row.
  // v0.8.5+ first (has `securities`; account_holdings is gone since 0007).
  const probeV085Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='securities'",
    )
    .get() as { n: number };
  const probeV06Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='account_holdings'",
    )
    .get() as { n: number };
  const probeV05Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
    )
    .get() as { n: number };
  const probeV03Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projection_overrides'",
    )
    .get() as { n: number };
  const schemaVersion =
    hashEra ??
    (probeV085Sqlite.n > 0
      ? "0004_v085_investments"
      : probeV06Sqlite.n > 0
        ? "v0.6_final"
        : probeV05Sqlite.n > 0
          ? "v0.5_final"
          : probeV03Sqlite.n > 0
            ? "v0.3_final"
            : "v0.2_final");

  log("info", "sqlite_squash_upgrade_start", {
    appliedMigrations: appliedCount,
    journalMigrations: journalCount,
    schemaVersion,
  });

  // 1. Export backup — never clear the journal without one.
  const backupPath = writePreMigrationBackupSQLite(sqlite, schemaVersion);
  requireBackupOrAbort(backupPath);

  // 2. Clear old journal
  sqlite.prepare("DELETE FROM __drizzle_migrations").run();

  // 3. Apply new migration idempotently and record hash
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require in SQLite dialect
  const crypto = require("crypto") as typeof import("crypto");
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    // The only per-tag data step is 0009's (V0810_TAG): it runs inside the
    // migration's transaction, before the statements drop what it reads.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s: string) => s.trim())
      .filter(Boolean);

    const applyTx = sqlite.transaction(() => {
      // v0.8.10 data conversion, before 0009 drops what it reads.
      if (entry.tag === V0810_TAG) applyV0810ProfileSetsSqlite(sqlite);
      for (const stmt of statements) {
        try {
          sqlite.exec(stmt);
        } catch (stmtErr) {
          const msg = (stmtErr as Error).message ?? "";
          // SQLite: "table X already exists", "duplicate column name", etc.
          // "no such column"/"no such table" is the mirror-image case — a
          // later migration already renamed/dropped what this (older,
          // blindly-replayed) migration is trying to touch. See the
          // matching IGNORABLE_PG_CODES comment in handleSquashUpgrade
          // above for why both directions are benign here.
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column") ||
            msg.includes("no such column") ||
            msg.includes("no such table") ||
            msg.includes("no such index")
          ) {
            // Idempotent — ignore
          } else {
            throw stmtErr;
          }
        }
      }
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(hash, String(Date.now()));
    });
    applyTx();
    log("info", "squash_migration_applied", { tag: entry.tag });
  }

  log("info", "sqlite_squash_upgrade_complete", { schemaVersion });
  return backupPath;
}

function runSQLite() {
  /* eslint-disable @typescript-eslint/no-require-imports -- dynamic require for SQLite dialect */
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dbPath = process.env.SQLITE_PATH ?? "data/ledgr.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  // Handle squash upgrade before running Drizzle's migrate()
  let backupPath = handleSQLiteSquashUpgrade(
    sqlite,
    "./drizzle-sqlite",
    "./drizzle-sqlite/meta/_journal.json",
  );

  // Apply any pending migrations idempotently. Mirrors the PostgreSQL pre-apply
  // step: handles upgrade DBs that already have tables/columns from old pre-squash
  // migrations (or a squash SQL that was generated from a later schema snapshot),
  // causing newer migrations to re-add DDL that already exists.
  {
    const journal = JSON.parse(
      fs.readFileSync(
        path.resolve("./drizzle-sqlite/meta/_journal.json"),
        "utf-8",
      ),
    );
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto") as typeof import("crypto");
    const appliedHashes = new Set(
      (
        sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
          hash: string;
        }[]
      ).map((r) => r.hash),
    );

    // Same rule as PostgreSQL: back up an existing install before changing
    // its schema, and don't migrate without a backup.
    const pending = pendingJournalEntries(
      journal,
      "./drizzle-sqlite",
      appliedHashes,
      crypto,
    );
    const hasAppTables = !!sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'",
      )
      .get();
    if (pending.pendingTags.length > 0 && !backupPath && hasAppTables) {
      log("info", "pre_migration_backup_start", {
        pending: pending.pendingTags,
        from: pending.lastAppliedTag,
        dialect: "sqlite",
      });
      backupPath = writePreMigrationBackupSqlite(sqlite);
      requireBackupOrAbort(backupPath);
    }

    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`./drizzle-sqlite/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");
      if (appliedHashes.has(hash)) continue;
      // The only per-tag data step is 0009's (V0810_TAG): it runs inside the
      // migration's transaction, before the statements drop what it reads.
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const applyTx = sqlite.transaction(() => {
        // v0.8.10 data conversion, before 0009 drops what it reads.
        if (entry.tag === V0810_TAG) applyV0810ProfileSetsSqlite(sqlite);
        for (const stmt of statements) {
          try {
            sqlite.exec(stmt);
          } catch (stmtErr) {
            const msg = (stmtErr as Error).message ?? "";
            if (
              msg.includes("already exists") ||
              msg.includes("duplicate column") ||
              msg.includes("no such column") ||
              msg.includes("no such table") ||
              msg.includes("no such index")
            ) {
              // idempotent — skip
            } else {
              throw stmtErr;
            }
          }
        }
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(hash, String(Date.now()));
      });
      applyTx();
      log("info", "migration_applied", { tag: entry.tag, dialect: "sqlite" });
    }
  }

  // Drizzle's own migrate() — always a no-op after the idempotent pre-apply
  // above, but retained as a safety net.
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle-sqlite" });
  log("info", "migrations_applied", { dialect: "sqlite", path: dbPath });

  // Write upgrade banner flag if a backup was created
  if (backupPath) {
    try {
      sqlite
        .prepare(
          `INSERT INTO app_settings (key, value)
           VALUES ('pre_upgrade_backup', json(?))
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        )
        .run(
          JSON.stringify({
            path: backupPath,
            createdAt: new Date().toISOString(),
          }),
        );
      log("info", "upgrade_banner_flag_set", { path: backupPath });
    } catch (flagErr) {
      log("warn", "upgrade_banner_flag_failed", {
        error: flagErr instanceof Error ? flagErr.message : String(flagErr),
      });
    }
  }

  // Reference-data reconcile (R43): additive, runs on every migrate. Mirrors
  // the Postgres path above — fails loudly rather than warn-and-continue.
  try {
    const seedSql = fs.readFileSync(
      path.resolve("./seed-reference-data.sql"),
      "utf-8",
    );
    const seedTables = parseSeedTableNames(seedSql);
    for (const table of seedTables) {
      const indexes = sqlite.prepare(`PRAGMA index_list("${table}")`).all() as {
        name: string;
        unique: number;
      }[];
      const hasYearScopedUnique = indexes.some((idx) => {
        if (idx.unique !== 1) return false;
        const cols = sqlite
          .prepare(`PRAGMA index_info("${idx.name}")`)
          .all() as { name: string }[];
        return cols.some((c) => c.name === "tax_year");
      });
      if (!hasYearScopedUnique) {
        throw new Error(
          `Reference table "${table}" has no tax_year-scoped unique constraint — ` +
            `seed reconcile would duplicate rows on every migrate. Add a unique index first.`,
        );
      }
    }
    sqlite.exec(seedSql);
    log("info", "reference_data_reconciled", { tables: seedTables.join(", ") });
  } finally {
    sqlite.close();
  }
}

async function run() {
  const dialect = getDialect();
  log("info", "migration_start", { dialect });

  try {
    if (dialect === "postgresql") {
      await runPostgres();
    } else {
      runSQLite();
    }
  } catch (err) {
    log("error", "migration_failed", {
      dialect,
      error: err instanceof Error ? err.message : String(err),
      code: (err as NodeJS.ErrnoException).code,
    });
    process.exit(1);
  }
}

// Guard the top-level side effect so this file can be imported (e.g. by a
// test) without actually running a migration. Vitest sets VITEST=true for
// every test process; the real deploy entry point (`tsx db-migrate.ts`)
// never sets it, so this is a no-op for the actual migration pipeline.
if (!process.env.VITEST) {
  run();
}
