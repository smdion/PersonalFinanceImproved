/**
 * Brings the reference tables (contribution limits, withholding / LTCG /
 * IRMAA tables, poverty lines, tax-data revisions) in line with the shipped
 * tax-data file (`tax-data/us-federal.json`) — without ever touching a
 * figure the household changed.
 *
 * Runs on every migrate (db-migrate.ts — which can't import src/, so the
 * block below is copied there verbatim; a test keeps the two identical), in
 * each live demo schema, and in the app after a restore / import / reset
 * (reference-data.ts). One code path for both databases: SQL goes through a
 * tiny adapter (`?` placeholders, `dialect`), and every decision is made
 * here in TypeScript, comparing numbers as numbers and JSON as parsed
 * values (stored text differs by dialect).
 */

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
 */
function* reconcileSteps(
  dialect: RefDialect,
  file: TaxDataFile,
): Generator<RefStep, { inserted: number; updated: number }, Rows> {
  const query = (sql: string, params: unknown[] = []) => ({ sql, params });
  if (file.formatVersion > TAX_DATA_FORMAT_VERSION)
    throw new Error(
      `tax-data file format ${file.formatVersion} is newer than this app reads (${TAX_DATA_FORMAT_VERSION})`,
    );
  const bool = (b: unknown) =>
    typeof b === "boolean" && dialect === "sqlite" ? (b ? 1 : 0) : b;
  const write = (r: ShippedRow) =>
    r.json ? JSON.stringify(r.value) : String(r.value);
  let inserted = 0;
  let updated = 0;

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
            "seed",
            file.dataVersion,
          ],
        );
        inserted++;
        continue;
      }
      let origin = String(row.origin);
      let version = Number(row.source_version ?? 0);
      const holdsShipped = sameReferenceValue(row[r.valueCol], r.value, r.json);
      if (
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
      const where = r.keyCols.map((c) => `${c} = ?`).join(" AND ");
      yield query(
        `UPDATE ${table} SET ${r.valueCol} = ?, ${r.notes !== undefined ? "notes = ?, " : ""}origin = 'seed', source_version = ?, confirmed_at = NULL WHERE ${where}`,
        [
          write(r),
          ...(r.notes !== undefined ? [r.notes] : []),
          file.dataVersion,
          ...keyParams,
        ],
      );
      updated++;
    }
  }
  return { inserted, updated };
}

/** Reconcile through an async driver. */
export async function reconcileReferenceRows(
  run: RefQuery,
  dialect: RefDialect,
  file: TaxDataFile,
): Promise<{ inserted: number; updated: number }> {
  const steps = reconcileSteps(dialect, file);
  let next = steps.next();
  while (!next.done)
    next = steps.next(await run(next.value.sql, next.value.params));
  return next.value;
}

/** Reconcile through a sync driver (better-sqlite3). */
export function reconcileReferenceRowsSync(
  run: RefQuerySync,
  file: TaxDataFile,
): { inserted: number; updated: number } {
  const steps = reconcileSteps("sqlite", file);
  let next = steps.next();
  while (!next.done) next = steps.next(run(next.value.sql, next.value.params));
  return next.value;
}
// END reference-reconcile-core
