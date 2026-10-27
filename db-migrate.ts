import * as fs from "fs";
import * as path from "path";

/** Kept equal to src/lib/db/demo-schema-marker.ts (standalone build; a test checks). */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";
/** Kept equal to src/lib/db/demo-schema-marker.ts — "<count>:<last hash>". */
export const MIGRATION_STAMP_SUBQUERY =
  "(SELECT count(*)::text || ':' || coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1), '') FROM drizzle.__drizzle_migrations)";

function log(
  level: "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>,
) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
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
 * Reference-data reconcile: the tax data (tax-data/us-federal/, one file a
 * year, assembled by assembleTaxData) is
 * applied on every migrate, in public and in each live demo schema, so a new
 * tax year or a corrected figure reaches existing installs — without ever
 * touching a figure the household changed (see reconcileReferenceRows). The
 * code below is a verbatim copy of src/lib/db/reference-reconcile-core.ts
 * (this file compiles standalone and can't import src/); a test keeps the
 * two identical.
 */
/** The tables the reconcile writes (a test keeps this in step with the core). */
export const REFERENCE_SEED_TABLES = new Set([
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
]);

function readTaxDataFile(): TaxDataFile {
  return readTaxDataDir(fs, path.resolve(TAX_DATA_DIR));
}

// BEGIN reference-reconcile-core (keep identical in db-migrate.ts)
export type RefDialect = "pg" | "sqlite";
type Rows = Record<string, unknown>[];
/** One statement with `?` placeholders; the driver sends back its rows. */
type RefStep = { sql: string; params: unknown[] };
/** Run one statement (async driver: Postgres, the app). */
export type RefQuery = (sql: string, params: unknown[]) => Promise<Rows>;
/** Run one statement (sync driver: better-sqlite3). */
export type RefQuerySync = (sql: string, params: unknown[]) => Rows;

/** Highest tax-data file format this code reads. */
export const TAX_DATA_FORMAT_VERSION = 1;

/** Who a reference figure came from. */
export const TAX_DATA_ORIGIN_VALUES = [
  "seed", // shipped with the app (the tax-data file)
  "carried", // copied forward from an earlier year, not yet confirmed
  "community", // the tax-data sync between releases
  "integration", // reserved for an outside data source
  "user", // the household typed or changed it
] as const;
export type TaxDataOrigin = (typeof TAX_DATA_ORIGIN_VALUES)[number];

type Brackets = unknown[];
export type TaxDataLimit = {
  value: number;
  /** Citation (IRS notice, Rev. Proc., …). */
  source: string;
  /** Plain-words note; the row's `notes` is this, else `source`. */
  notes?: string;
  /** Values this key shipped with before — an install still holding one
   *  is corrected (when nobody changed it). */
  supersedes?: number[];
  exception?: { reason: string; source: string };
};
export type TaxDataYear = {
  revision: number;
  source: string;
  notes?: string;
  /** Every citation the year uses → a link to the document (each
   *  `source` is one or more citations joined by "; "). Required by the
   *  validator; optional here so older files still parse. */
  sources?: Record<string, string>;
  limits: Record<string, TaxDataLimit>;
  withholding: {
    source: string;
    notes?: string;
    tables: Record<string, { standard: Brackets; checkbox: Brackets }>;
    supersedes?: Record<
      string,
      { standard?: Brackets[]; checkbox?: Brackets[] }
    >;
    exception?: { reason: string; source: string };
  };
  ltcg?: {
    source: string;
    brackets: Record<string, Brackets>;
    supersedes?: Record<string, Brackets[]>;
    exception?: { reason: string; source: string };
  };
  irmaa?: {
    source: string;
    brackets: Record<string, Brackets>;
    supersedes?: Record<string, Brackets[]>;
    exception?: { reason: string; source: string };
  };
  fpl?: {
    source: string;
    amounts: Record<string, number>;
    supersedes?: Record<string, number>[];
    exception?: { reason: string; source: string };
  };
};
export type TaxDataFile = {
  formatVersion: number;
  /** Increases with every change to the file. */
  dataVersion: number;
  years: Record<string, TaxDataYear>;
};

/** Where the tax data lives in the repo (and the image): `index.json`
 *  (formatVersion, dataVersion) and one `YYYY.json` per year. Everything
 *  reads it as one TaxDataFile (assembleTaxData) — the published, signed
 *  file is that same single shape. */
export const TAX_DATA_DIR = "tax-data/us-federal";

/** The directory's files → one TaxDataFile. A `$schema` line in any file
 *  is the editor's and is dropped. Throws on a file that isn't
 *  `index.json` or `YYYY.json`. */
export function assembleTaxData(
  files: readonly { name: string; text: string }[],
): TaxDataFile {
  const drop = (o: Record<string, unknown>) => {
    const { $schema: _schema, ...rest } = o;
    return rest;
  };
  const index = files.find((f) => f.name === "index.json");
  if (!index) throw new Error(`${TAX_DATA_DIR}/index.json is missing`);
  const head = drop(JSON.parse(index.text)) as {
    formatVersion: number;
    dataVersion: number;
  };
  const years: Record<string, TaxDataYear> = {};
  for (const f of files) {
    if (f.name === "index.json") continue;
    const m = /^(\d{4})\.json$/.exec(f.name);
    if (!m)
      throw new Error(
        `${TAX_DATA_DIR}/${f.name}: only index.json and YYYY.json belong here`,
      );
    years[m[1]!] = drop(JSON.parse(f.text)) as TaxDataYear;
  }
  return {
    formatVersion: head.formatVersion,
    dataVersion: head.dataVersion,
    years: Object.fromEntries(
      Object.keys(years)
        .sort()
        .map((y) => [y, years[y]!]),
    ),
  };
}

/** A year with every figure filled in. A year being added
 *  (`pnpm tax-data:new-year`, blanks until filled) isn't: the reconcile
 *  skips it, so a half-done year never reaches a database. */
export function isCompleteTaxDataYear(d: TaxDataYear): boolean {
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const rows = (b: unknown) =>
    (Array.isArray(b) ? b : []) as Record<string, unknown>[];
  return (
    Object.values(d.limits ?? {}).every((l) => num(l?.value)) &&
    Object.values(d.withholding?.tables ?? {}).every((t) =>
      [t?.standard, t?.checkbox].every((k) =>
        rows(k).every(
          (r) => num(r.threshold) && num(r.baseWithholding) && num(r.rate),
        ),
      ),
    ) &&
    Object.values(d.ltcg?.brackets ?? {}).every((b) =>
      rows(b).every(
        (r, i, all) =>
          num(r.rate) &&
          (num(r.threshold) || (r.threshold === null && i === all.length - 1)),
      ),
    ) &&
    Object.values(d.irmaa?.brackets ?? {}).every((b) =>
      rows(b).every((r) => num(r.magiThreshold) && num(r.annualSurcharge)),
    ) &&
    Object.values(d.fpl?.amounts ?? {}).every(num)
  );
}

/** Read the tax-data directory with the caller's fs (the app, the
 *  migrator and scripts share this). */
export function readTaxDataDir(
  fsLike: {
    readdirSync: (p: string) => string[];
    readFileSync: (p: string, enc: "utf-8") => string;
  },
  dir: string = TAX_DATA_DIR,
): TaxDataFile {
  // Only index.json and YYYY.json — a stray file must not stop a start
  // (tax-data:check and the tests assemble every file, strictly).
  return assembleTaxData(
    fsLike
      .readdirSync(dir)
      .filter((n) => /^(index|\d{4})\.json$/.test(n))
      .map((name) => ({
        name,
        text: fsLike.readFileSync(`${dir}/${name}`, "utf-8"),
      })),
  );
}

/** One shipped row: its table, natural key, value and older values. */
type ShippedRow = {
  table: string;
  keyCols: string[];
  keyVals: unknown[];
  valueCol: string;
  value: unknown;
  json: boolean;
  /** contribution_limits only. */
  notes?: string;
  supersedes: unknown[];
};

/** Every row the file ships, flattened. */
export function shippedReferenceRows(file: TaxDataFile): ShippedRow[] {
  const rows: ShippedRow[] = [];
  for (const [y, data] of Object.entries(file.years)) {
    const year = Number(y);
    for (const [type, l] of Object.entries(data.limits))
      rows.push({
        table: "contribution_limits",
        keyCols: ["tax_year", "limit_type"],
        keyVals: [year, type],
        valueCol: "value",
        value: l.value,
        json: false,
        notes: l.notes ?? l.source,
        supersedes: l.supersedes ?? [],
      });
    for (const [status, t] of Object.entries(data.withholding.tables))
      for (const kind of ["standard", "checkbox"] as const)
        rows.push({
          table: "tax_brackets",
          keyCols: ["tax_year", "filing_status", "w4_checkbox"],
          keyVals: [year, status, kind === "checkbox"],
          valueCol: "brackets",
          value: t[kind],
          json: true,
          supersedes: data.withholding.supersedes?.[status]?.[kind] ?? [],
        });
    for (const [section, table] of [
      ["ltcg", "ltcg_brackets"],
      ["irmaa", "irmaa_brackets"],
    ] as const) {
      const s = data[section];
      if (!s) continue;
      for (const [status, b] of Object.entries(s.brackets))
        rows.push({
          table,
          keyCols: ["tax_year", "filing_status"],
          keyVals: [year, status],
          valueCol: "brackets",
          value: b,
          json: true,
          supersedes: s.supersedes?.[status] ?? [],
        });
    }
    if (data.fpl)
      rows.push({
        table: "fpl_by_household",
        keyCols: ["tax_year"],
        keyVals: [year],
        valueCol: "amounts",
        value: data.fpl.amounts,
        json: true,
        supersedes: data.fpl.supersedes ?? [],
      });
  }
  return rows;
}

/** JSON as a comparable value: parsed, numbers as numbers, object keys
 *  sorted, null / missing keys dropped (the LTCG top bracket's threshold
 *  may be stored either way); array order kept. */
function canonical(v: unknown): unknown {
  if (typeof v === "string") {
    try {
      return canonical(JSON.parse(v));
    } catch {
      return v;
    }
  }
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== null && x !== undefined) out[k] = canonical(x);
    }
    return out;
  }
  if (typeof v === "boolean") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

/** Same figure? Numbers compared numerically (decimal text differs by
 *  dialect), JSON compared parsed. A false "no" only leaves a row alone. */
export function sameReferenceValue(
  a: unknown,
  b: unknown,
  json: boolean,
): boolean {
  // Stored at scale 6 (decimal(12,6)): equal to that precision. Float
  // noise from a percent typed in Settings (1.45 → 0.0144999…) is no change.
  if (!json) return Math.abs(Number(a) - Number(b)) < 5e-7;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Where a reconcile's figures come from: the file shipped with this
 *  version, or a community update an admin approved. */
export type RefMode = "seed" | "community";

/** One figure the reconcile added or changed (notes-only changes aren't
 *  listed). `key` names the row, e.g. "2026|ira_limit". */
export type RefChange = {
  table: string;
  key: string;
  kind: "insert" | "update";
  from: unknown;
  to: unknown;
};

export type RefResult = {
  inserted: number;
  updated: number;
  changes: RefChange[];
};

function rowKey(keyVals: unknown[]): string {
  return keyVals
    .map((v) => (typeof v === "boolean" ? (v ? "1" : "0") : String(v)))
    .join("|");
}

/**
 * Reconcile the reference tables with the file:
 * 1. A row nobody has classified yet (`origin='user'` and never confirmed —
 *    i.e. from before tracking, or an old backup) holding the shipped value
 *    or one it supersedes is recognised as shipped.
 * 2. Shipped rows (`seed`, or a `community` sync) from an older file
 *    version, and `carried` rows, take the file's value and notes.
 * 3. Rows the household changed (`user`) are never touched; years and keys
 *    the file doesn't have are never touched or removed. A shipped row's
 *    notes follow the file too (Settings doesn't edit notes; a note change
 *    alone doesn't make a row the household's).
 * 4. Missing rows are added. `tax_params` takes a higher revision.
 * 5. A household-started year past the file's newest gets any figure it
 *    lacks, carried forward from the newest shipped year.
 *
 * Step 5 runs once, with the last file applied (`carryForward`): a seed
 * pass followed by a community pass leaves it to the community file,
 * whose newest year is the real one.
 *
 * `community` mode (an approved community update) never runs step 1 — an
 * outside file must not reclassify the household's rows — writes only
 * rows whose value changes, and marks them `community`.
 */
function* reconcileSteps(
  dialect: RefDialect,
  file: TaxDataFile,
  mode: RefMode,
  carryForward: boolean,
): Generator<RefStep, RefResult, Rows> {
  const query = (sql: string, params: unknown[] = []) => ({ sql, params });
  if (file.formatVersion > TAX_DATA_FORMAT_VERSION)
    throw new Error(
      `tax-data file format ${file.formatVersion} is newer than this app reads (${TAX_DATA_FORMAT_VERSION})`,
    );
  // A year still being filled in is never written.
  file = {
    ...file,
    years: Object.fromEntries(
      Object.entries(file.years).filter(([, d]) => isCompleteTaxDataYear(d)),
    ),
  };
  const bool = (b: unknown) =>
    typeof b === "boolean" && dialect === "sqlite" ? (b ? 1 : 0) : b;
  const write = (r: ShippedRow) =>
    r.json ? JSON.stringify(r.value) : String(r.value);
  let inserted = 0;
  let updated = 0;
  const changes: RefChange[] = [];

  for (const [y, data] of Object.entries(file.years)) {
    const [current] = yield query(
      "SELECT version FROM tax_params WHERE tax_year = ?",
      [Number(y)],
    );
    if (!current) {
      yield query(
        "INSERT INTO tax_params (tax_year, version, source, notes) VALUES (?, ?, ?, ?)",
        [Number(y), data.revision, data.source, data.notes ?? null],
      );
      inserted++;
    } else if (Number(current.version) < data.revision) {
      yield query(
        "UPDATE tax_params SET version = ?, source = ?, notes = ? WHERE tax_year = ?",
        [data.revision, data.source, data.notes ?? null, Number(y)],
      );
      updated++;
    }
  }

  const shipped = shippedReferenceRows(file);
  for (const table of [...new Set(shipped.map((r) => r.table))]) {
    const mine = shipped.filter((r) => r.table === table);
    const keyCols = mine[0]!.keyCols;
    const existing = new Map(
      (yield query(`SELECT * FROM ${table}`)).map((row) => [
        rowKey(keyCols.map((c) => row[c])),
        row,
      ]),
    );
    for (const r of mine) {
      const row = existing.get(rowKey(r.keyVals));
      const keyParams = r.keyVals.map(bool);
      if (!row) {
        const cols = [
          ...r.keyCols,
          r.valueCol,
          ...(r.notes !== undefined ? ["notes"] : []),
          "origin",
          "source_version",
        ];
        yield query(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          [
            ...keyParams,
            write(r),
            ...(r.notes !== undefined ? [r.notes] : []),
            mode,
            file.dataVersion,
          ],
        );
        inserted++;
        changes.push({
          table,
          key: rowKey(r.keyVals),
          kind: "insert",
          from: null,
          to: r.value,
        });
        continue;
      }
      let origin = String(row.origin);
      let version = Number(row.source_version ?? 0);
      const holdsShipped = sameReferenceValue(row[r.valueCol], r.value, r.json);
      if (
        mode === "seed" &&
        origin === "user" &&
        row.confirmed_at == null &&
        (holdsShipped ||
          r.supersedes.some((s) =>
            sameReferenceValue(row[r.valueCol], s, r.json),
          ))
      ) {
        origin = "seed";
        version = 0;
      }
      const behind =
        origin === "carried" ||
        ((origin === "seed" || origin === "community") &&
          version < file.dataVersion);
      if (!behind) continue;
      if (mode === "community" && holdsShipped) continue;
      const where = r.keyCols.map((c) => `${c} = ?`).join(" AND ");
      yield query(
        `UPDATE ${table} SET ${r.valueCol} = ?, ${r.notes !== undefined ? "notes = ?, " : ""}origin = ?, source_version = ?, confirmed_at = NULL WHERE ${where}`,
        [
          write(r),
          ...(r.notes !== undefined ? [r.notes] : []),
          mode,
          file.dataVersion,
          ...keyParams,
        ],
      );
      updated++;
      if (!holdsShipped)
        changes.push({
          table,
          key: rowKey(r.keyVals),
          kind: "update",
          from: row[r.valueCol],
          to: r.value,
        });
    }
  }

  // 5. A year the household started beyond the file's newest (an early
  //    "+ Year") gets each figure the newest shipped year has and it lacks
  //    — a figure added in this release — as carried forward, so a figure
  //    the calculators require is never missing. Its own rows stand.
  const fileYears = Object.keys(file.years).map(Number);
  if (carryForward && fileYears.length > 0) {
    const newest = Math.max(...fileYears);
    const newestLimits = file.years[String(newest)]!.limits;
    const have = new Map<number, Set<string>>();
    for (const row of yield query(
      "SELECT tax_year, limit_type FROM contribution_limits WHERE tax_year > ?",
      [newest],
    )) {
      const y = Number(row.tax_year);
      if (!have.has(y)) have.set(y, new Set());
      have.get(y)!.add(String(row.limit_type));
    }
    for (const [year, keys] of have)
      for (const [type, l] of Object.entries(newestLimits)) {
        if (keys.has(type)) continue;
        yield query(
          "INSERT INTO contribution_limits (tax_year, limit_type, value, notes, origin) VALUES (?, ?, ?, ?, 'carried')",
          [year, type, String(l.value), l.notes ?? l.source],
        );
        inserted++;
        changes.push({
          table: "contribution_limits",
          key: rowKey([year, type]),
          kind: "insert",
          from: null,
          to: l.value,
        });
      }
  }
  return { inserted, updated, changes };
}

/** The newest approved community file this code can read that's newer
 *  than the shipped one (`rows`: tax_data_updates `file_text`s with status
 *  'applied', any order), or null. Every limit key is kept: one this
 *  version doesn't use shows as "not used by Ledgr", and is in place for
 *  the version that does. */
export function pickApprovedCommunityFile(
  rows: { file_text: unknown }[],
  shippedVersion: number,
): TaxDataFile | null {
  let best: TaxDataFile | null = null;
  for (const r of rows) {
    let f: TaxDataFile;
    try {
      f = JSON.parse(String(r.file_text)) as TaxDataFile;
    } catch {
      continue;
    }
    if (
      f.formatVersion <= TAX_DATA_FORMAT_VERSION &&
      f.dataVersion > shippedVersion &&
      (!best || f.dataVersion > best.dataVersion)
    )
      best = f;
  }
  return best;
}

/** Reconcile through an async driver. */
export async function reconcileReferenceRows(
  run: RefQuery,
  dialect: RefDialect,
  file: TaxDataFile,
  mode: RefMode = "seed",
  carryForward = true,
): Promise<RefResult> {
  const steps = reconcileSteps(dialect, file, mode, carryForward);
  let next = steps.next();
  while (!next.done)
    next = steps.next(await run(next.value.sql, next.value.params));
  return next.value;
}

/** Reconcile through a sync driver (better-sqlite3). */
export function reconcileReferenceRowsSync(
  run: RefQuerySync,
  file: TaxDataFile,
  mode: RefMode = "seed",
  carryForward = true,
): RefResult {
  const steps = reconcileSteps("sqlite", file, mode, carryForward);
  let next = steps.next();
  while (!next.done) next = steps.next(run(next.value.sql, next.value.params));
  return next.value;
}
// END reference-reconcile-core

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
  "debts",
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
// pre-release 0004–0011 that v0.8.5 squashed into one, and of the v0.9 line
// (its baseline first). Add each new migration here when it ships. The LATEST applied row names exactly where an install was, so a
// backup taken before the squash is labelled with its real schema tag
// (all are in backup-transforms' V08_SCHEMA_TAGS).
export const V08_MIGRATION_HASHES: Record<string, string> = {
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
  // v0.8.11: where reinvested RMD money goes (per Retirement Profile).
  "0366e7ae1b9763c3f54b88688d82045f70e204c8817fbad10ce68c9d9e4e975c":
    "0011_v0811_rmd_excess_target",
  // v0.8.14: Performance notes, estimated fields, accepted checks.
  "887f50d59ffe2a1e15e321d1116a106d652e8ac4ad96ec0c3d7a5db112690651":
    "0012_v0814_perf_annotations",
  // v0.9.0 squash: the v0.8 line (0000_v8 + 0001–0012) as one baseline.
  "4ed68e830f616dd677dddd9e0dd48a0b84a3b758a5766acffea2da1090cca153":
    "0000_v9_initial_schema",
  // v0.9.0: where each reference figure came from (origin, source_version, confirmed_at).
  d210c1418b4e930b2244c6bd723b5a9672f33621c753fa59fcb8cde5a467adf6:
    "0001_v090_tax_data_origin",
  // v0.9.0: community tax-data updates fetched and decided.
  "8031a00f15f435979edae028edd12267db92c427f7cd333b5949a343fffcbaf4":
    "0002_v090_tax_data_updates",
  // v0.9.0: utilities cost feed (category + billing lag per service, cost source per reading).
  "5dbf28830857afa5c706a3186d2038f849575e81732b8362de57d7cbd62fb34d":
    "0003_v090_utility_feed",
  // v0.9.0: debts list (Liabilities).
  d835e0d55fdd16f70497e222b3f5113f2f73365a24063a3d0430001b37d75534:
    "0004_v090_debts",
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

// ---------------------------------------------------------------------------
// Supported upgrade path + schema checks (both dialects)
// ---------------------------------------------------------------------------

/**
 * The tag a backup of a database at the baseline's schema carries: the last
 * migration of the release line squashed into `0000_v9_initial_schema`
 * (v0.8.15 shipped no migration of its own, so v0.8.14's).
 */
export const SQUASHED_LINE_TIP = "0012_v0814_perf_annotations";

/** The database is from a release this one can't upgrade directly. Never
 *  swallowed — the migration stops with the database untouched. */
export class UpgradePathError extends Error {
  override name = "UpgradePathError";
}

type Journal = { entries: { idx: number; tag: string }[] };

function readJournal(migrationsFolder: string): Journal {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(`${migrationsFolder}/meta/_journal.json`),
      "utf-8",
    ),
  );
}

function fileHash(
  crypto: typeof import("crypto"),
  filePath: string,
): string | null {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(p, "utf-8"))
    .digest("hex");
}

/** Table → column names of a journal entry's drizzle snapshot. */
export function snapshotColumns(
  migrationsFolder: string,
  idx: number,
): Map<string, string[]> {
  const snap = JSON.parse(
    fs.readFileSync(
      path.resolve(
        `${migrationsFolder}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
      ),
      "utf-8",
    ),
  ) as {
    tables: Record<
      string,
      { name: string; columns: Record<string, { name: string }> }
    >;
  };
  return new Map(
    Object.values(snap.tables).map((t) => [
      t.name,
      Object.values(t.columns).map((c) => c.name),
    ]),
  );
}

/** What a snapshot has that the database doesn't ("table" or "table.column"). */
export function missingFromSnapshot(
  expected: Map<string, string[]>,
  actual: Map<string, Set<string>>,
): string[] {
  const missing: string[] = [];
  for (const [table, cols] of expected) {
    const have = actual.get(table);
    if (!have) {
      missing.push(table);
      continue;
    }
    for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  return missing;
}

function columnMap(
  rows: { table_name: string; column_name: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, new Set());
    m.get(r.table_name)!.add(r.column_name);
  }
  return m;
}

/**
 * Where an existing database's schema is, by the journal: the last entry
 * whose file hash is recorded, else the last entry whose snapshot's tables
 * and columns are all present (a journal cleared by a failed run), else —
 * the baseline's schema — the squashed line's tip. The label restore
 * transforms key on. The shape fallback only sees additions: once a
 * migration after the baseline drops or renames something, an emptied
 * journal could be labelled one entry early.
 */
export function schemaLabel(
  journal: Journal,
  migrationsFolder: string,
  recordedHashes: Set<string>,
  actual: Map<string, Set<string>>,
  crypto: typeof import("crypto"),
): string {
  const { lastAppliedTag } = pendingJournalEntries(
    journal,
    migrationsFolder,
    recordedHashes,
    crypto,
  );
  if (lastAppliedTag) return lastAppliedTag;
  for (const entry of [...journal.entries].reverse()) {
    if (entry.idx === 0) break;
    if (
      missingFromSnapshot(snapshotColumns(migrationsFolder, entry.idx), actual)
        .length === 0
    )
      return entry.tag;
  }
  return SQUASHED_LINE_TIP;
}

/**
 * Refuse a database older than the baseline. Squashing replays the
 * baseline's CREATE TABLEs, which an existing table silently skips — so an
 * install that predates the baseline would never get the columns its
 * release line added later. Allowed: a fresh install (no `people`), one
 * that has recorded the baseline, and one with every table and column of
 * the baseline's snapshot (v0.8.14/v0.8.15, a dev database on any v0.9
 * migration, a journal cleared by a failed run). Anything else stops here,
 * before any backup or change.
 */
export function assertSupportedUpgradePath(
  journal: Journal,
  migrationsFolder: string,
  recordedHashes: Set<string>,
  actual: Map<string, Set<string>>,
  crypto: typeof import("crypto"),
  era: () => string,
): void {
  if (!actual.has("people")) return;
  const baseline = journal.entries[0];
  if (!baseline) return;
  const baselineHash = fileHash(
    crypto,
    `${migrationsFolder}/${baseline.tag}.sql`,
  );
  if (baselineHash && recordedHashes.has(baselineHash)) return;
  const missing = missingFromSnapshot(
    snapshotColumns(migrationsFolder, baseline.idx),
    actual,
  );
  if (missing.length === 0) return;
  throw new UpgradePathError(
    `This database is from an older Ledgr (schema ${era()}). This release upgrades from v0.8.14 or later: update to v0.8.15 first, start it once so it migrates, then update to this release. Nothing has been changed. Missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}.`,
  );
}

/** Index names of a journal entry's drizzle snapshot. */
function snapshotIndexes(migrationsFolder: string, idx: number): string[] {
  const snap = JSON.parse(
    fs.readFileSync(
      path.resolve(
        `${migrationsFolder}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
      ),
      "utf-8",
    ),
  ) as {
    tables: Record<string, { indexes?: Record<string, { name: string }> }>;
  };
  return Object.values(snap.tables).flatMap((t) =>
    Object.values(t.indexes ?? {}).map((i) => i.name),
  );
}

/**
 * After a squash replay: every table, column and index of the latest
 * snapshot. Indexes too because the replay skips a unique violation — a
 * CREATE UNIQUE INDEX over duplicate rows would otherwise be skipped
 * silently.
 */
function assertSchemaComplete(
  journal: Journal,
  migrationsFolder: string,
  actual: Map<string, Set<string>>,
  actualIndexes: Set<string>,
): void {
  const last = journal.entries[journal.entries.length - 1];
  if (!last) return;
  const missing = [
    ...missingFromSnapshot(snapshotColumns(migrationsFolder, last.idx), actual),
    ...snapshotIndexes(migrationsFolder, last.idx)
      .filter((name) => !actualIndexes.has(name))
      .map((name) => `index ${name}`),
  ];
  if (missing.length > 0)
    throw new Error(
      `Squash replay left the schema incomplete (missing ${missing.slice(0, 8).join(", ")}) — rolled back, nothing changed.`,
    );
}

async function pgIndexes(
  client: import("pg").PoolClient,
): Promise<Set<string>> {
  const { rows } = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  return new Set(rows.map((r) => r.indexname));
}

async function pgColumns(
  client: import("pg").PoolClient,
): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  return columnMap(rows);
}

async function pgRecordedHashes(
  client: import("pg").PoolClient,
): Promise<Set<string>> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations') AS exists`,
  );
  if (!rows[0]?.exists) return new Set();
  const { rows: hashes } = await client.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations",
  );
  return new Set(hashes.map((r) => r.hash));
}

async function assertSupportedUpgradePathPg(
  pool: import("pg").Pool,
  migrationsFolder: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    const crypto = await import("crypto");
    const actual = await pgColumns(client);
    if (!actual.has("people")) return;
    const era = await detectSchemaEra(client);
    assertSupportedUpgradePath(
      readJournal(migrationsFolder),
      migrationsFolder,
      await pgRecordedHashes(client),
      actual,
      crypto,
      () => era,
    );
  } finally {
    client.release();
  }
}

// "Already done" AND "already moved past" are both benign when replaying a
// migration whose hash isn't recorded against a database that may already be
// past it. A migration that creates something that already exists
// (duplicate_*) is as expected as one that references a column/table a later
// migration already renamed or dropped (undefined_column/undefined_table).
const IGNORABLE_PG_CODES = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table
  "42710", // duplicate_object (index, constraint, etc.)
  "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
  "23505", // unique_violation
  "42703", // undefined_column — already renamed/dropped by a later migration
  "42P01", // undefined_table — already renamed/dropped by a later migration
]);

/** Run one migration file's statements inside the caller's transaction, each
 *  under a savepoint so an ignorable error skips only that statement. */
async function applyStatementsPg(
  client: import("pg").PoolClient,
  sql: string,
): Promise<void> {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await client.query("SAVEPOINT apply_stmt");
    try {
      await client.query(stmt);
      await client.query("RELEASE SAVEPOINT apply_stmt");
    } catch (stmtErr) {
      const code = (stmtErr as { code?: string }).code;
      if (code && IGNORABLE_PG_CODES.has(code)) {
        await client.query("ROLLBACK TO SAVEPOINT apply_stmt");
      } else {
        throw stmtErr;
      }
    }
  }
}

/**
 * Handle a migration squash: when the database has more applied migrations
 * than the journal has entries (or none recorded but tables present, or
 * recorded hashes that don't match the journal's), the migrations were
 * squashed since it last ran. assertSupportedUpgradePathPg has already
 * established the database is at the baseline's schema or past it. This:
 * 1. writes a pre-upgrade backup (always — none means stop),
 * 2. in ONE transaction: clears __drizzle_migrations, replays every journal
 *    entry idempotently (savepoints, ignorable errors skipped), records each
 *    hash, and checks every table and column of the latest snapshot exists.
 * Any failure rolls the whole thing back and stops the migration — nothing
 * is half done, and the previous image still runs against the database.
 * After this, the pre-apply loop and Drizzle's migrate() are no-ops.
 */
async function handleSquashUpgrade(
  pool: import("pg").Pool,
  migrationsFolder: string,
): Promise<SquashResult> {
  const client = await pool.connect();
  let backupPathBeforeFailure: string | null = null;
  try {
    const { rows: tableCheck } = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const recordedHashes = await pgRecordedHashes(client);
    const { rows: countRows } = await client.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount: number = countRows[0]?.count ?? 0;
    const journal = readJournal(migrationsFolder);
    const journalCount = journal.entries.length;
    const crypto = await import("crypto");
    const actual = await pgColumns(client);

    // Squash detection. Three cases trigger recovery:
    //   1. appliedCount > journalCount — a squash collapsed N migrations
    //      into M < N entries.
    //   2. appliedCount == 0 with existing application tables — a journal
    //      cleared by an earlier failed run.
    //   3. Hash mismatch — as many rows as entries, but the first
    //      `appliedCount` entries' file hashes aren't all recorded (a squash
    //      that kept the entry count). Entries beyond appliedCount are new
    //      and go through the normal pre-apply path.
    const needsRecovery =
      appliedCount > journalCount ||
      (appliedCount === 0 && actual.has("people")) ||
      (appliedCount > 0 &&
        journal.entries.slice(0, appliedCount).some((entry) => {
          const h = fileHash(crypto, `${migrationsFolder}/${entry.tag}.sql`);
          return h !== null && !recordedHashes.has(h);
        }));
    if (!needsRecovery)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const schemaVersion = schemaLabel(
      journal,
      migrationsFolder,
      recordedHashes,
      actual,
      crypto,
    );
    log("info", "squash_upgrade_start", {
      appliedMigrations: appliedCount,
      journalMigrations: journalCount,
      schemaVersion,
    });

    // 1. Backup — never clear the journal without one.
    const backupPath = await writePreMigrationBackupPg(client, schemaVersion);
    backupPathBeforeFailure = backupPath;
    requireBackupOrAbort(backupPath);

    // 2. Clear, replay, record, check — all or nothing.
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        await applyStatementsPg(client, sql);
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [
            crypto.createHash("sha256").update(sql).digest("hex"),
            String(Date.now()),
          ],
        );
        log("info", "squash_migration_applied", { tag: entry.tag });
      }
      assertSchemaComplete(
        journal,
        migrationsFolder,
        await pgColumns(client),
        await pgIndexes(client),
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    }

    log("info", "squash_upgrade_complete", {
      schemaVersion,
      removedEntries: appliedCount,
    });
    return { backupPath, schemaVersion, wasSquash: true };
  } catch (err) {
    log("error", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      ...(backupPathBeforeFailure
        ? {
            message: `Nothing was changed; a backup was written to ${backupPathBeforeFailure} before the failure.`,
            backupPath: backupPathBeforeFailure,
          }
        : {}),
    });
    throw err;
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
    // Refuse a database older than the baseline before anything else —
    // outside the squash, so nothing can swallow it.
    await assertSupportedUpgradePathPg(pool, "./drizzle");

    // Handle squash upgrade: if the DB has more applied migrations than the
    // journal, a schema squash occurred. Backs up, then clears the old
    // journal and replays the new one in one transaction — so the pre-apply
    // loop and Drizzle's migrate() below become no-ops.
    const squash = await handleSquashUpgrade(pool, "./drizzle");
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

      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const hash = crypto.createHash("sha256").update(sql).digest("hex");
        if (recordedHashes.has(hash)) continue;
        await preClient.query("BEGIN");
        try {
          await applyStatementsPg(preClient, sql);
          await preClient.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [hash, String(Date.now())],
          );
          await preClient.query("COMMIT");
          log("info", "migration_applied", { tag: entry.tag });
        } catch (txErr) {
          await preClient.query("ROLLBACK").catch(() => {});
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
    // count and last hash (src/lib/db/demo-schema-marker.ts); any whose
    // stamp doesn't match the current one was built for an older structure. Checked on
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
                  $1 || ${MIGRATION_STAMP_SUBQUERY}
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

    // Reference-data reconcile: the tax-data file, in public and in each
    // live demo schema (demo reference data comes from the file, never from
    // the household's own rows). Fails the migrate loudly — a silently
    // skipped reconcile is how a seed fix never reaches prod.
    const seedClient = await pool.connect();
    try {
      const file = readTaxDataFile();
      const pgQuery: RefQuery = async (text, params) => {
        let i = 0;
        const res = await seedClient.query(
          text.replace(/\?/g, () => `$${++i}`),
          params,
        );
        return res.rows as Record<string, unknown>[];
      };
      // One transaction per schema: a failure part-way leaves nothing half
      // applied (it's idempotent, but a mixed state shouldn't serve traffic).
      const inTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
        await seedClient.query("BEGIN");
        try {
          const out = await fn();
          await seedClient.query("COMMIT");
          return out;
        } catch (err) {
          await seedClient.query("ROLLBACK");
          throw err;
        }
      };
      // An approved community update newer than this image's file is
      // applied after it (the shipped file can't add what it doesn't have).
      const community = pickApprovedCommunityFile(
        (
          await seedClient.query<{ file_text: string }>(
            "SELECT file_text FROM tax_data_updates WHERE status = 'applied'",
          )
        ).rows,
        file.dataVersion,
      );
      const bothFiles = async () => {
        const seeded = await reconcileReferenceRows(
          pgQuery,
          "pg",
          file,
          "seed",
          !community,
        );
        const updated = community
          ? await reconcileReferenceRows(pgQuery, "pg", community, "community")
          : null;
        return {
          inserted: seeded.inserted + (updated?.inserted ?? 0),
          updated: seeded.updated + (updated?.updated ?? 0),
        };
      };
      const result = await inTransaction(bothFiles);
      log("info", "reference_data_reconciled", {
        dataVersion: file.dataVersion,
        communityDataVersion: community?.dataVersion ?? null,
        ...result,
      });
      const { rows: demos } = await seedClient.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_%'`,
      );
      for (const { nspname } of demos) {
        const schemaIdent = `"${nspname.replace(/"/g, '""')}"`;
        try {
          await seedClient.query(`SET search_path TO ${schemaIdent}`);
          await inTransaction(bothFiles);
        } finally {
          await seedClient.query("SET search_path TO public");
        }
      }
      if (demos.length > 0)
        log("info", "demo_reference_data_reconciled", {
          schemas: demos.map((d) => d.nspname).join(", "),
        });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
  }
}

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

type SqliteDb = InstanceType<typeof import("better-sqlite3")>;

/**
 * SQLite twin of detectSchemaEra — only words the refusal message now. The
 * first migration a post-squash install applied is its release-line
 * baseline (SQLite spellings of BASELINE_HASHES); older installs fall back
 * to schema-shape probes.
 */
function detectSchemaEraSqlite(sqlite: SqliteDb): string {
  const SQLITE_BASELINE_HASHES: Record<string, string> = {
    dc91abbd28dd17fc654c9712fb27ce8f922708ccaaad7a4d68acbc19d8a7c685:
      "v0.7_final",
    d640cf13da448193bc3cd36084a9495bf8f826d3a3df15f0cfe4acfb6776c2d3:
      "v0.6_final",
  };
  try {
    const firstRow = sqlite
      .prepare(
        "SELECT hash FROM __drizzle_migrations ORDER BY rowid ASC LIMIT 1",
      )
      .get() as { hash?: string } | undefined;
    const era = firstRow?.hash && SQLITE_BASELINE_HASHES[firstRow.hash];
    if (era) return era;
  } catch {
    // no journal — fall through to probes
  }
  const has = (sql: string) =>
    (sqlite.prepare(sql).get() as { n: number }).n > 0;
  const table = (name: string) =>
    has(
      `SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='${name}'`,
    );
  if (table("securities")) return "0004_v085_investments";
  if (table("account_holdings")) return "v0.6_final";
  if (
    has(
      "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
    )
  )
    return "v0.5_final";
  if (table("projection_overrides")) return "v0.3_final";
  return "v0.2_final";
}

function sqliteColumns(sqlite: SqliteDb): Map<string, Set<string>> {
  return columnMap(
    sqlite
      .prepare(
        "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      )
      .all() as { table_name: string; column_name: string }[],
  );
}

function sqliteRecordedHashes(sqlite: SqliteDb): Set<string> {
  const exists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  if (!exists) return new Set();
  return new Set(
    (
      sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
        hash: string;
      }[]
    ).map((r) => r.hash),
  );
}

/** Run one migration file's statements inside the caller's transaction,
 *  skipping the ones that are already done (or already moved past — see
 *  IGNORABLE_PG_CODES). */
function applyStatementsSqlite(sqlite: SqliteDb, sql: string): void {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter(Boolean);
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
}

/**
 * SQLite twin of handleSquashUpgrade (see its docblock): same detection,
 * backup first (an exact VACUUM INTO copy), then clear + replay + record +
 * check in one transaction; any failure rolls back and stops.
 */
function handleSQLiteSquashUpgrade(
  sqlite: SqliteDb,
  migrationsFolder: string,
): string | null {
  const tableExists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  if (!tableExists) return null;

  const recordedHashes = sqliteRecordedHashes(sqlite);
  const appliedCount = (
    sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    }
  ).n;
  const journal = readJournal(migrationsFolder);
  const journalCount = journal.entries.length;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require in SQLite dialect
  const crypto = require("crypto") as typeof import("crypto");
  const actual = sqliteColumns(sqlite);

  // The same three cases as handleSquashUpgrade.
  const needsRecovery =
    appliedCount > journalCount ||
    (appliedCount === 0 && actual.has("people")) ||
    (appliedCount > 0 &&
      journal.entries.slice(0, appliedCount).some((entry) => {
        const h = fileHash(crypto, `${migrationsFolder}/${entry.tag}.sql`);
        return h !== null && !recordedHashes.has(h);
      }));
  if (!needsRecovery) return null;

  const schemaVersion = schemaLabel(
    journal,
    migrationsFolder,
    recordedHashes,
    actual,
    crypto,
  );
  log("info", "sqlite_squash_upgrade_start", {
    appliedMigrations: appliedCount,
    journalMigrations: journalCount,
    schemaVersion,
  });

  // 1. Backup — never clear the journal without one.
  const backupPath = writePreMigrationBackupSqlite(sqlite);
  requireBackupOrAbort(backupPath);

  // 2. Clear, replay, record, check — all or nothing.
  try {
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM __drizzle_migrations").run();
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        applyStatementsSqlite(sqlite, sql);
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(
            crypto.createHash("sha256").update(sql).digest("hex"),
            String(Date.now()),
          );
        log("info", "squash_migration_applied", { tag: entry.tag });
      }
      assertSchemaComplete(
        journal,
        migrationsFolder,
        sqliteColumns(sqlite),
        new Set(
          (
            sqlite
              .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
              .all() as { name: string }[]
          ).map((r) => r.name),
        ),
      );
    })();
  } catch (err) {
    log("error", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      message: `Nothing was changed; a backup was written to ${backupPath} before the failure.`,
      backupPath,
    });
    throw err;
  }

  log("info", "sqlite_squash_upgrade_complete", { schemaVersion });
  return backupPath;
}

export function runSQLite() {
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

  // Refuse a database older than the baseline before anything else.
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto") as typeof import("crypto");
    assertSupportedUpgradePath(
      readJournal("./drizzle-sqlite"),
      "./drizzle-sqlite",
      sqliteRecordedHashes(sqlite),
      sqliteColumns(sqlite),
      crypto,
      () => detectSchemaEraSqlite(sqlite),
    );
  }

  // Handle squash upgrade before running Drizzle's migrate()
  let backupPath = handleSQLiteSquashUpgrade(sqlite, "./drizzle-sqlite");

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
      const applyTx = sqlite.transaction(() => {
        applyStatementsSqlite(sqlite, sql);
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

  // Reference-data reconcile: the tax-data file. Mirrors the Postgres path
  // above — fails loudly rather than warn-and-continue.
  try {
    const file = readTaxDataFile();
    const run = (text: string, params: unknown[]) => {
      const stmt = sqlite.prepare(text);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    };
    const community = pickApprovedCommunityFile(
      sqlite
        .prepare(
          "SELECT file_text FROM tax_data_updates WHERE status = 'applied'",
        )
        .all() as { file_text: string }[],
      file.dataVersion,
    );
    const result = sqlite.transaction(() => {
      const seeded = reconcileReferenceRowsSync(run, file, "seed", !community);
      const updated = community
        ? reconcileReferenceRowsSync(run, community, "community")
        : null;
      return {
        inserted: seeded.inserted + (updated?.inserted ?? 0),
        updated: seeded.updated + (updated?.updated ?? 0),
      };
    })();
    log("info", "reference_data_reconciled", {
      dataVersion: file.dataVersion,
      communityDataVersion: community?.dataVersion ?? null,
      ...result,
    });
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
