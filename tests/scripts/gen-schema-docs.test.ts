/**
 * docs/SCHEMA.md reads each table's real columns from drizzle's config, and
 * a jsonb column's shape line fails the run once it names something gone.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildSchemaDoc,
  mermaidType,
  readJsonbTypes,
  readTables,
  type SchemaDocInput,
} from "../../scripts/gen-schema-docs";

const owners = pgTable("owners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});
const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    backupOwnerId: integer("backup_owner_id").references(() => owners.id),
    value: numeric("value", { precision: 14, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    entries: jsonb("entries").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("holdings_owner_value_idx").on(t.ownerId, t.value),
    uniqueIndex("holdings_active_idx")
      .on(t.ownerId)
      .where(sql`${t.isActive} = true`),
  ],
);

function input(over: Partial<SchemaDocInput> = {}): SchemaDocInput {
  return {
    tables: readTables({ owners, holdings, notATable: 3 }),
    jsonbTypes: new Map([["holdings.entries", "string[]"]]),
    shapes: {},
    oldStoredShapes: "| `lib/db/stored-entries.ts` | ... |",
    exports: (file, name) =>
      file === "lib/db/stored-entries.ts" && name === "readEntries",
    journals: {
      postgres: { entries: [{ idx: 0, tag: "0000_first" }] },
      sqlite: { entries: [{ idx: 0, tag: "0000_first" }] },
    },
    ...over,
  };
}

describe("readTables", () => {
  it("reads each column's type, keys, not-null, default and foreign key", () => {
    const [h, o] = readTables({ owners, holdings });
    expect(o!.name).toBe("owners");
    expect(o!.columns.find((c) => c.name === "name")).toMatchObject({
      unique: true,
      notNull: true,
    });
    expect(h!.name).toBe("holdings");
    const byName = Object.fromEntries(h!.columns.map((c) => [c.name, c]));
    expect(byName.id).toMatchObject({ type: "serial", primaryKey: true });
    expect(byName.owner_id).toMatchObject({
      type: "integer",
      notNull: true,
      references: { table: "owners", column: "id", onDelete: "cascade" },
    });
    expect(byName.backup_owner_id).toMatchObject({
      notNull: false,
      references: { table: "owners", column: "id" },
    });
    expect(byName.value).toMatchObject({
      type: "numeric(14, 2)",
      defaultValue: "'0'",
    });
    expect(byName.is_active!.defaultValue).toBe("true");
    expect(byName.entries).toMatchObject({ type: "jsonb", defaultValue: "[]" });
    expect(byName.created_at).toMatchObject({
      type: "timestamp with time zone",
      notNull: false,
      defaultValue: "now()",
    });
    expect(h!.compositeKeys).toEqual([
      "Unique: (owner_id) where is_active = true",
      "Unique: (owner_id, value)",
    ]);
  });
});

describe("readJsonbTypes", () => {
  it("reads a jsonb column's $type from the schema source", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "gen-schema-docs-"));
    try {
      const file = path.join(dir, "t.ts");
      fs.writeFileSync(
        file,
        `export const t = pgTable("things", {
  data: jsonb("data")
    .$type<{
      a: number;
    }>()
    .notNull(),
  raw: jsonb("raw"),
});`,
      );
      expect([...readJsonbTypes([file])]).toEqual([
        ["things.data", "{ a: number }"],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildSchemaDoc", () => {
  it("lists the columns, the relations by column and the schema version", () => {
    const md = buildSchemaDoc(input());
    expect(md).toContain("**Schema version: `0000_first`**");
    expect(md).toContain("| 0000 | first | yes | yes |");
    expect(md).toContain("    numeric_14_2 value\n");
    expect(md).toContain("    integer owner_id FK\n");
    expect(md).toContain('  holdings }o--|| owners : "owner_id"\n');
    expect(md).toContain('  holdings }o--o| owners : "backup_owner_id"\n');
    expect(md).toContain(
      "| owner_id | integer | yes |  | FK → owners.id (on delete cascade) |",
    );
    expect(md).toContain("- `entries`: type `string[]`; unchecked\n");
  });

  it("names a jsonb column's shape, reader and FALLBACKS row", () => {
    const md = buildSchemaDoc(
      input({
        shapes: {
          "holdings.entries": {
            reader: "lib/db/stored-entries.ts#readEntries",
            fallbacks: "lib/db/stored-entries.ts",
          },
        },
      }),
    );
    expect(md).toContain(
      "- `entries`: type `string[]`; read through `readEntries` " +
        "(lib/db/stored-entries.ts); **old shapes still read (FALLBACKS)**\n",
    );
  });

  it("fails on a retired reader, a removed FALLBACKS row or a non-jsonb column", () => {
    const shapes = (shape: SchemaDocInput["shapes"][string]) =>
      input({ shapes: { "holdings.entries": shape } });
    expect(() =>
      buildSchemaDoc(shapes({ reader: "lib/db/stored-entries.ts#gone" })),
    ).toThrow(/not exported from src\/lib\/db\/stored-entries\.ts/);
    expect(() =>
      buildSchemaDoc(shapes({ fallbacks: "lib/db/retired.ts" })),
    ).toThrow(/no longer lists/);
    expect(() =>
      buildSchemaDoc(input({ shapes: { "holdings.value": { note: "x" } } })),
    ).toThrow(/not a jsonb column/);
  });

  it("says when the two journals disagree", () => {
    const md = buildSchemaDoc(
      input({
        journals: {
          postgres: {
            entries: [
              { idx: 0, tag: "0000_first" },
              { idx: 1, tag: "0001_second" },
            ],
          },
          sqlite: { entries: [{ idx: 0, tag: "0000_first" }] },
        },
      }),
    );
    expect(md).toContain(
      "**Schema version: PostgreSQL `0001_second`, SQLite `0000_first`**",
    );
    expect(md).toContain("| 0001 | second | yes | no |");
  });
});

describe("mermaidType", () => {
  it("makes a SQL type a mermaid attribute type", () => {
    expect(mermaidType("timestamp with time zone")).toBe("timestamptz");
    expect(mermaidType("text[]")).toBe("text_array");
    expect(mermaidType("double precision")).toBe("double_precision");
  });
});
