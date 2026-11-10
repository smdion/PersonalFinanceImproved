/**
 * docs/SCHEMA.md: the PostgreSQL schema as drizzle itself reads it
 * (`getTableConfig` over src/lib/db/schema-pg.ts's tables), so a migration
 * that adds a column, a key or a tag shows up here. Each table's columns
 * (type, primary key, not-null, default, unique, foreign key), a mermaid
 * diagram of the relations by foreign-key column, what each jsonb column is
 * read and written through (scripts/schema-jsonb-shapes.ts), and the schema
 * version from both migration journals. Written by scripts/gen-api-docs.ts.
 */
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { Column, is, SQL, StringChunk } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { pgSchemaFiles } from "./pg-schema-source";
import { JSONB_SHAPES, type JsonbShape } from "./schema-jsonb-shapes";

export interface ColumnDoc {
  name: string;
  /** The SQL type, e.g. `numeric(14, 2)`. */
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  /** The default as written, shortened; null when there is none. */
  defaultValue: string | null;
  unique: boolean;
  /** `table.column` the foreign key points at, with its on-delete rule. */
  references: { table: string; column: string; onDelete?: string } | null;
}

export interface TableDoc {
  name: string;
  columns: ColumnDoc[];
  /** Multi-column primary keys and unique constraints or indexes. */
  compositeKeys: string[];
}

const DEFAULT_MAX = 40;

function sqlText(value: SQL): string {
  return value.queryChunks
    .map((chunk) => {
      if (is(chunk, StringChunk)) return chunk.value.join("");
      if (is(chunk, SQL)) return sqlText(chunk);
      if (is(chunk, Column)) return chunk.name;
      return typeof chunk === "string" ? chunk : "?";
    })
    .join("");
}

function defaultText(column: PgColumn): string | null {
  let text: string;
  if (column.defaultFn) text = "set by the app";
  else if (!column.hasDefault || column.default === undefined) return null;
  else if (is(column.default, SQL)) text = sqlText(column.default);
  else if (typeof column.default === "string") text = `'${column.default}'`;
  else text = JSON.stringify(column.default);
  return text.length > DEFAULT_MAX
    ? `${text.slice(0, DEFAULT_MAX - 1)}…`
    : text;
}

function columnNames(columns: unknown[]): string[] | null {
  const names: string[] = [];
  for (const c of columns) {
    if (is(c, SQL) || !c || typeof c !== "object" || !("name" in c)) {
      return null; // an expression index: not a column key
    }
    names.push(String((c as { name: string }).name));
  }
  return names;
}

/** Every pgTable among a module's exports, as drizzle's config reads it. */
export function readTables(modules: Record<string, unknown>): TableDoc[] {
  const tables: TableDoc[] = [];
  for (const value of Object.values(modules)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const foreignKeys = new Map<string, ColumnDoc["references"]>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length !== 1) continue; // none today; listed below
      foreignKeys.set(ref.columns[0]!.name, {
        table: getTableConfig(ref.foreignTable).name,
        column: ref.foreignColumns[0]!.name,
        ...(fk.onDelete && fk.onDelete !== "no action"
          ? { onDelete: fk.onDelete }
          : {}),
      });
    }
    const uniqueSingles = new Set<string>();
    const compositeKeys: string[] = [];
    const keyed = (label: string, names: string[] | null) => {
      if (!names) return;
      if (names.length === 1 && label === "Unique")
        uniqueSingles.add(names[0]!);
      else compositeKeys.push(`${label}: (${names.join(", ")})`);
    };
    for (const pk of config.primaryKeys) {
      keyed("Primary key", columnNames(pk.columns));
    }
    for (const u of config.uniqueConstraints) {
      keyed("Unique", columnNames(u.columns));
    }
    for (const index of config.indexes) {
      if (!index.config.unique) continue;
      const names = columnNames(index.config.columns);
      if (index.config.where && names) {
        compositeKeys.push(
          `Unique: (${names.join(", ")}) where ${sqlText(index.config.where)}`,
        );
      } else keyed("Unique", names);
    }
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length === 1) continue;
      compositeKeys.push(
        `Foreign key: (${ref.columns.map((c) => c.name).join(", ")}) → ` +
          `${getTableConfig(ref.foreignTable).name} (${ref.foreignColumns.map((c) => c.name).join(", ")})`,
      );
    }
    tables.push({
      name: config.name,
      columns: config.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType(),
        primaryKey: column.primary,
        notNull: column.notNull,
        defaultValue: defaultText(column),
        unique: column.isUnique || uniqueSingles.has(column.name),
        references: foreignKeys.get(column.name) ?? null,
      })),
      compositeKeys: [...new Set(compositeKeys)].sort(),
    });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

/** `table.column` → the `.$type<…>()` a pg schema file gives a jsonb column. */
export function readJsonbTypes(files: string[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const file of files) {
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node, table: string | null): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "pgTable" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        table = node.arguments[0].text;
      }
      if (table && ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "$type" &&
          node.typeArguments?.[0]
        ) {
          let base: ts.Expression = callee.expression;
          while (
            ts.isCallExpression(base) &&
            ts.isPropertyAccessExpression(base.expression)
          ) {
            base = base.expression.expression;
          }
          if (
            ts.isCallExpression(base) &&
            ts.isIdentifier(base.expression) &&
            base.expression.text === "jsonb" &&
            base.arguments[0] &&
            ts.isStringLiteral(base.arguments[0])
          ) {
            types.set(
              `${table}.${base.arguments[0].text}`,
              node.typeArguments[0]
                .getText(sf)
                .replace(/\s+/g, " ")
                .replace(/; }/g, " }"),
            );
          }
        }
      }
      ts.forEachChild(node, (child) => visit(child, table));
    };
    visit(sf, null);
  }
  return types;
}

export interface Journal {
  entries: { idx: number; tag: string }[];
}

export interface SchemaDocInput {
  tables: TableDoc[];
  jsonbTypes: Map<string, string>;
  shapes: Record<string, JsonbShape>;
  /** The text of docs/FALLBACKS.md § Old stored shapes. */
  oldStoredShapes: string;
  /** Whether `src/<file>` exports `name`. */
  exports: (file: string, name: string) => boolean;
  journals: { postgres: Journal; sqlite: Journal };
}

function jsonbNote(key: string, input: SchemaDocInput): string {
  const shape = input.shapes[key];
  const type = input.jsonbTypes.get(key);
  const parts: string[] = [];
  if (type) parts.push(`type \`${type}\``);
  if (!shape?.shape && !shape?.reader) parts.push("unchecked");
  const named = (ref: string, what: string): string => {
    const [file, name] = ref.split("#");
    if (!file || !name || !input.exports(file, name)) {
      throw new Error(
        `gen-schema-docs: ${key}'s ${what} ${ref} is not exported from src/${file}; ` +
          "update its line in scripts/schema-jsonb-shapes.ts",
      );
    }
    return `\`${name}\` (${file})`;
  };
  if (shape?.shape) {
    parts.push(
      `shape ${named(shape.shape, "shape")}` +
        (shape.parsed === "nowhere"
          ? ", parsed nowhere"
          : `, parsed on ${shape.parsed ?? "?"}`),
    );
  }
  if (shape?.reader)
    parts.push(`read through ${named(shape.reader, "reader")}`);
  if (shape?.note) parts.push(shape.note);
  if (shape?.fallbacks) {
    if (!input.oldStoredShapes.includes(shape.fallbacks)) {
      throw new Error(
        `gen-schema-docs: ${key} names the FALLBACKS site ${shape.fallbacks}, which ` +
          "§ Old stored shapes no longer lists; update its line in scripts/schema-jsonb-shapes.ts",
      );
    }
    parts.push("**old shapes still read (FALLBACKS)**");
  }
  return parts.join("; ");
}

/** A SQL type as a mermaid attribute type: `numeric(14, 2)` → `numeric_14_2`. */
export function mermaidType(type: string): string {
  return type
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace(/\[\]/g, "_array")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function schemaVersion(journals: SchemaDocInput["journals"]): string {
  const pg = journals.postgres.entries;
  const lite = journals.sqlite.entries;
  const latest = (entries: Journal["entries"]) => entries.at(-1)?.tag ?? "none";
  let md = "## Schema version\n\n";
  md +=
    latest(pg) === latest(lite)
      ? `**Schema version: \`${latest(pg)}\`** (the latest tag in both \`drizzle/meta/_journal.json\` and \`drizzle-sqlite/meta/_journal.json\`).\n\n`
      : `**Schema version: PostgreSQL \`${latest(pg)}\`, SQLite \`${latest(lite)}\`** (the journals disagree).\n\n`;
  const tags = [...new Set([...pg, ...lite].map((e) => e.tag))].sort();
  md += "| Tag | Name | PostgreSQL | SQLite |\n|---|---|---|---|\n";
  for (const tag of tags) {
    const [, number = tag, name = ""] = /^(\d+)_(.*)$/.exec(tag) ?? [];
    const has = (entries: Journal["entries"]) =>
      entries.some((e) => e.tag === tag) ? "yes" : "no";
    md += `| ${number} | ${name} | ${has(pg)} | ${has(lite)} |\n`;
  }
  return md + "\n";
}

export function buildSchemaDoc(input: SchemaDocInput): string {
  const { tables } = input;
  const jsonbColumns = new Set(
    tables.flatMap((t) =>
      t.columns
        .filter((c) => c.type === "jsonb")
        .map((c) => `${t.name}.${c.name}`),
    ),
  );
  for (const key of Object.keys(input.shapes)) {
    if (!jsonbColumns.has(key)) {
      throw new Error(
        `gen-schema-docs: scripts/schema-jsonb-shapes.ts names ${key}, which is not a jsonb column`,
      );
    }
  }

  let md = "# Database Schema\n\n";
  md +=
    "> **Auto-generated** by `scripts/gen-api-docs.ts` (`scripts/gen-schema-docs.ts`) from " +
    "drizzle's own table config of `src/lib/db/schema-pg.ts`. Do not edit by hand. " +
    "Run `pnpm docs:update` to regenerate.\n\n";
  md +=
    `**${tables.length} tables.** The PostgreSQL schema; the SQLite schema is generated from it ` +
    "(`scripts/gen-sqlite-schema.ts`). A jsonb column's shapes are listed in " +
    "`scripts/schema-jsonb-shapes.ts`.\n\n";
  md += schemaVersion(input.journals);

  md += "## Relations\n\n";
  md +=
    "Each line is a foreign key, labelled by its column; `o|` marks one that may be null.\n\n";
  md += "```mermaid\nerDiagram\n";
  for (const t of tables) {
    md += `  ${t.name} {\n`;
    for (const c of t.columns) {
      const keys = [
        c.primaryKey && "PK",
        c.references && "FK",
        c.unique && !c.primaryKey && "UK",
      ].filter(Boolean);
      md += `    ${mermaidType(c.type)} ${c.name}${keys.length ? ` ${keys.join(", ")}` : ""}\n`;
    }
    md += "  }\n";
  }
  for (const t of tables) {
    for (const c of t.columns) {
      if (!c.references) continue;
      md += `  ${t.name} }o--${c.notNull ? "||" : "o|"} ${c.references.table} : "${c.name}"\n`;
    }
  }
  md += "```\n\n";

  md += "## Tables\n\n";
  for (const t of tables) {
    md += `### ${t.name}\n\n`;
    md +=
      "| Column | Type | Not null | Default | Notes |\n|---|---|---|---|---|\n";
    for (const c of t.columns) {
      const notes: string[] = [];
      if (c.primaryKey) notes.push("PK");
      if (c.unique && !c.primaryKey) notes.push("unique");
      if (c.references) {
        notes.push(
          `FK → ${c.references.table}.${c.references.column}` +
            (c.references.onDelete
              ? ` (on delete ${c.references.onDelete})`
              : ""),
        );
      }
      if (c.type === "jsonb") notes.push("shape below");
      md +=
        `| ${c.name} | ${cell(c.type)} | ${c.notNull ? "yes" : ""} | ` +
        `${c.defaultValue === null ? "" : `\`${cell(c.defaultValue)}\``} | ${cell(notes.join("; "))} |\n`;
    }
    md += "\n";
    const lines = [
      ...t.compositeKeys,
      ...t.columns
        .filter((c) => c.type === "jsonb")
        .map(
          (c) => `\`${c.name}\`: ${jsonbNote(`${t.name}.${c.name}`, input)}`,
        ),
    ];
    for (const line of lines) md += `- ${line}\n`;
    if (lines.length) md += "\n";
  }
  return md;
}

/** The section of docs/FALLBACKS.md that lists the old stored shapes still read. */
function oldStoredShapesSection(root: string): string {
  const text = fs.readFileSync(path.join(root, "docs/FALLBACKS.md"), "utf8");
  const start = text.indexOf("## Old stored shapes");
  if (start === -1)
    throw new Error(
      "gen-schema-docs: docs/FALLBACKS.md has no § Old stored shapes",
    );
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

export async function generateSchemaDoc(root: string): Promise<string> {
  const schema = (await import("../src/lib/db/schema-pg")) as Record<
    string,
    unknown
  >;
  const journal = (dir: string): Journal =>
    JSON.parse(
      fs.readFileSync(path.join(root, dir, "meta/_journal.json"), "utf8"),
    ) as Journal;
  return buildSchemaDoc({
    tables: readTables(schema),
    jsonbTypes: readJsonbTypes(pgSchemaFiles(root)),
    shapes: JSONB_SHAPES,
    oldStoredShapes: oldStoredShapesSection(root),
    exports: (file, name) => {
      const full = path.join(root, "src", file);
      return (
        fs.existsSync(full) &&
        new RegExp(`export (?:async )?(?:const|function) ${name}\\b`).test(
          fs.readFileSync(full, "utf8"),
        )
      );
    },
    journals: {
      postgres: journal("drizzle"),
      sqlite: journal("drizzle-sqlite"),
    },
  });
}
