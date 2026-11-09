/** How a converter's result reaches the database or a backup's rows: each
 *  write checked, one statement per row, in the order DESIGN gives. No
 *  import from migration-converters.ts, which runs these. */

/** One row's new column values, keyed by the row's `id`. */
export type RowUpdate = {
  readonly table: string;
  readonly id: number;
  readonly set: Readonly<Record<string, unknown>>;
};

/** A new row's column values; the database numbers it. */
export type RowInsert = {
  readonly table: string;
  readonly row: Readonly<Record<string, unknown>>;
};

/** The row with this `id` goes (its children first: no cascade fires). */
export type RowDelete = { readonly table: string; readonly id: number };

/** Applied as deletes, then updates, then inserts, each in list order and
 *  each naming exactly one row. */
export type ConverterResult = {
  readonly updates: readonly RowUpdate[];
  readonly inserts?: readonly RowInsert[];
  readonly deletes?: readonly RowDelete[];
  readonly notes: readonly string[];
};

export const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Null, text, a finite number, a boolean, or a plain object or array of
 *  them (a JSON column), at any depth. */
function writable(value: unknown): boolean {
  if (value === null || typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every(writable);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(writable);
}

/** What a write names in an error: "Converter update t id 3". */
const updateLabel = (u: RowUpdate) => `Converter update ${u.table} id ${u.id}`;
const insertLabel = (i: RowInsert) => `Converter insert into ${i.table}`;
const deleteLabel = (d: RowDelete) => `Converter delete ${d.table} id ${d.id}`;

/** Anything else (undefined, NaN, a Date) is a converter bug: it stops the
 *  migration rather than reach the database as something else. */
function checked(label: string, column: string, value: unknown): unknown {
  if (!writable(value))
    throw new Error(`${label}: ${column} can't be written (${String(value)})`);
  return value;
}

/** A value as a statement parameter: objects and arrays as JSON text, a
 *  boolean as 1/0 on SQLite (better-sqlite3 binds no booleans). */
function param(
  label: string,
  column: string,
  raw: unknown,
  sqlite: boolean,
): unknown {
  const value = checked(label, column, raw);
  if (typeof value === "boolean" && sqlite) return value ? 1 : 0;
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value;
}

type Statement = { label: string; sql: string; params: unknown[] };
type Placeholder = (i: number) => string;

function updateSql(u: RowUpdate, at: Placeholder, sqlite: boolean): Statement {
  const label = updateLabel(u);
  const cols = Object.keys(u.set);
  if (cols.length === 0 || !Number.isSafeInteger(u.id))
    throw new Error(
      `Converter update ${u.table} id ${String(u.id)} sets nothing or names no row`,
    );
  const sets = cols.map((c, i) => `${quoted(c)} = ${at(i + 1)}`);
  return {
    label,
    sql: `UPDATE ${quoted(u.table)} SET ${sets.join(", ")} WHERE "id" = ${at(cols.length + 1)}`,
    params: [...cols.map((c) => param(label, c, u.set[c], sqlite)), u.id],
  };
}

/** The database numbers the row, so it never names an `id`. */
function insertSql(i: RowInsert, at: Placeholder, sqlite: boolean): Statement {
  const label = insertLabel(i);
  const cols = Object.keys(i.row);
  if (cols.length === 0 || cols.includes("id"))
    throw new Error(`${label} sets nothing or names an id`);
  return {
    label,
    sql: `INSERT INTO ${quoted(i.table)} (${cols.map(quoted).join(", ")}) VALUES (${cols.map((_, n) => at(n + 1)).join(", ")})`,
    params: cols.map((c) => param(label, c, i.row[c], sqlite)),
  };
}

function deleteSql(d: RowDelete, at: Placeholder): Statement {
  const label = deleteLabel(d);
  if (!Number.isSafeInteger(d.id))
    throw new Error(
      `Converter delete ${d.table} id ${String(d.id)} names no row`,
    );
  return {
    label,
    sql: `DELETE FROM ${quoted(d.table)} WHERE "id" = ${at(1)}`,
    params: [d.id],
  };
}

/** Every statement of a result, in the order it applies them; each is
 *  built (and so checked) before the first one runs. */
export function statements(
  r: ConverterResult,
  at: Placeholder,
  sqlite: boolean,
): Statement[] {
  return [
    ...(r.deletes ?? []).map((d) => deleteSql(d, at)),
    ...r.updates.map((u) => updateSql(u, at, sqlite)),
    ...(r.inserts ?? []).map((i) => insertSql(i, at, sqlite)),
  ];
}

/** Each write names exactly one row. */
export function assertOneRow(
  label: string,
  changed: number | null | undefined,
) {
  if (changed !== 1)
    throw new Error(`${label} changed ${String(changed)} rows, not 1`);
}

type BackupRow = Record<string, unknown>;
const isBackupRow = (r: unknown): r is BackupRow =>
  typeof r === "object" && r !== null;

/** A backup table's rows with this id (an update or delete needs one). */
function rowsWithId(
  tables: Record<string, unknown[]>,
  table: string,
  id: number,
) {
  return (tables[table] ?? []).filter(
    (r): r is BackupRow => isBackupRow(r) && r["id"] === id,
  );
}

/** A converter's result applied to a backup's rows in place (a JSON column
 *  keeps the object); an inserted row takes the table's next id. */
export function applyToBackup(
  tables: Record<string, unknown[]>,
  r: ConverterResult,
) {
  for (const d of r.deletes ?? []) {
    const rows = rowsWithId(tables, d.table, d.id);
    assertOneRow(deleteLabel(d), rows.length);
    const list = tables[d.table]!;
    list.splice(list.indexOf(rows[0]), 1);
  }
  for (const u of r.updates) {
    const rows = rowsWithId(tables, u.table, u.id);
    assertOneRow(updateLabel(u), rows.length);
    for (const column of Object.keys(u.set))
      rows[0]![column] = structuredClone(
        checked(updateLabel(u), column, u.set[column]),
      );
  }
  for (const i of r.inserts ?? []) {
    insertSql(i, () => "?", false); // the same checks as the database's
    const list = (tables[i.table] ??= []);
    const last = list.reduce<number>((max, x) => {
      const id = isBackupRow(x) ? x["id"] : undefined;
      return typeof id === "number" && id > max ? id : max;
    }, 0);
    list.push({ ...structuredClone(i.row), id: last + 1 });
  }
}
