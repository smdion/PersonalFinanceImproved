/**
 * Auto-generated API + schema docs (v0.5 expert-review M25).
 *
 * Walks src/server/routers/ and src/lib/db/schema-pg.ts and writes:
 *   - docs/API_ROUTERS.md  — one-line summary of every tRPC procedure
 *   - docs/SCHEMA.md       — mermaid ER diagram of every table
 *
 * Both files are regenerated on demand. Don't hand-edit them — the
 * verify-docs hook (.claude/hooks/verify-docs.sh) runs this when the
 * router or schema files change.
 *
 * Usage: npx tsx scripts/gen-api-docs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ROUTERS_DIR = path.join(ROOT, "src/server/routers");
const SCHEMA_PATH = path.join(ROOT, "src/lib/db/schema-pg.ts");
const API_DOCS_OUT = path.join(ROOT, "docs/API_ROUTERS.md");
const SCHEMA_DOCS_OUT = path.join(ROOT, "docs/SCHEMA.md");

// ── Router catalog ───────────────────────────────────────────────────

interface ProcedureEntry {
  router: string;
  name: string;
  kind: "query" | "mutation";
  procType: string; // "protectedProcedure", "adminProcedure", etc.
  description: string;
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function* walkRouterFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkRouterFiles(full);
    } else if (e.isFile() && /\.ts$/.test(e.name) && e.name !== "index.ts") {
      yield full;
    }
  }
}

/**
 * Parse a router file and extract procedure entries.
 * Looks for patterns like:
 *   computeFoo: protectedProcedure.input(...).query(async ({ ctx }) => { ... })
 *   updateBar: budgetProcedure.input(...).mutation(async ({ ... }) => { ... })
 *
 * Description is the JSDoc / // comment immediately above the procedure.
 */
function parseRouterFile(filePath: string): ProcedureEntry[] {
  const content = readFileSafe(filePath);
  const router = path
    .relative(ROUTERS_DIR, filePath)
    .replace(/\.ts$/, "")
    .replace(/\\/g, "/");
  const lines = content.split("\n");
  const entries: ProcedureEntry[] = [];

  // Match: <name>: <something>Procedure(.something)*\.((query|mutation))
  // Handles multi-line with the procedure call broken across lines.
  // Strategy: scan line-by-line for `<name>: ` followed within next ~30 lines
  // by `.query(` or `.mutation(`.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const procMatch = line.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(\w+)/);
    if (!procMatch) continue;
    const [, name, procType] = procMatch;
    if (!procType || !procType.endsWith("Procedure")) continue;

    // Look ahead up to 30 lines for .query( or .mutation(
    let kind: "query" | "mutation" | null = null;
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      const next = lines[j]!;
      if (next.includes(".query(")) {
        kind = "query";
        break;
      }
      if (next.includes(".mutation(")) {
        kind = "mutation";
        break;
      }
    }
    if (!kind) continue;

    // Look behind for a JSDoc / // comment block
    let description = "";
    for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
      const prev = lines[k]!.trim();
      if (prev === "" || prev === "}") break;
      if (prev.startsWith("/**")) {
        // single-line jsdoc
        const m = prev.match(/\/\*\*\s*(.+?)\s*\*\//);
        if (m) {
          description = m[1]!;
          break;
        }
      }
      if (prev.startsWith("*")) {
        const cleaned = prev
          .replace(/^\*\s?\/?/, "")
          .replace(/\*\/$/, "")
          .trim();
        if (cleaned && !cleaned.startsWith("@")) {
          description = cleaned + (description ? " " + description : "");
        }
      } else if (prev.startsWith("//")) {
        description =
          prev.slice(2).trim() + (description ? " " + description : "");
      } else if (description) {
        break;
      }
    }

    entries.push({
      router,
      name: name!,
      kind,
      procType: procType!,
      description: description || "(no description)",
    });
  }

  return entries;
}

function buildRouterCatalog(): string {
  const allEntries: ProcedureEntry[] = [];
  for (const file of walkRouterFiles(ROUTERS_DIR)) {
    allEntries.push(...parseRouterFile(file));
  }

  // Group by router
  const byRouter = new Map<string, ProcedureEntry[]>();
  for (const e of allEntries) {
    const list = byRouter.get(e.router) ?? [];
    list.push(e);
    byRouter.set(e.router, list);
  }

  let md = "# tRPC Router Catalog\n\n";
  md +=
    "> **Auto-generated** by `scripts/gen-api-docs.ts`. " +
    "Do not edit by hand. Run `npx tsx scripts/gen-api-docs.ts` to regenerate.\n\n";
  md += `**${allEntries.length} procedures across ${byRouter.size} routers.**\n\n`;
  md += "Procedure type tags: `protectedProcedure` (any signed-in user), ";
  md +=
    "`adminProcedure` (admin role), `<domain>Procedure` (permission-scoped), ";
  md += "`publicProcedure` (no auth).\n\n";

  const sortedRouters = Array.from(byRouter.keys()).sort();
  for (const router of sortedRouters) {
    md += `## \`${router}\`\n\n`;
    md += "| Procedure | Kind | Auth | Description |\n";
    md += "|---|---|---|---|\n";
    const procs = byRouter.get(router)!;
    procs.sort((a, b) => a.name.localeCompare(b.name));
    for (const p of procs) {
      const desc = p.description.replace(/\|/g, "\\|").slice(0, 200);
      md += `| \`${p.name}\` | ${p.kind} | \`${p.procType}\` | ${desc} |\n`;
    }
    md += "\n";
  }

  return md;
}

// ── Schema ER diagram ────────────────────────────────────────────────

interface TableInfo {
  name: string;
  fkTargets: { col: string; targetTable: string }[];
}

function parseSchemaFile(): TableInfo[] {
  const content = readFileSafe(SCHEMA_PATH);
  const tables: TableInfo[] = [];

  // Match: export const <varName> = pgTable("<tableName>", { ... });
  // For each, extract FK references inside the body.
  const tableRegex = /export const (\w+) = pgTable\(\s*"([^"]+)"/g;
  let match;
  while ((match = tableRegex.exec(content)) !== null) {
    const varName = match[1]!;
    const tableName = match[2]!;
    // Find the matching closing of this table definition by tracking braces
    // from the opening { after pgTable("name",
    const startIdx = content.indexOf("{", match.index);
    if (startIdx === -1) continue;
    let depth = 1;
    let endIdx = startIdx + 1;
    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === "{") depth++;
      else if (content[endIdx] === "}") depth--;
      endIdx++;
    }
    const body = content.slice(startIdx, endIdx);

    // Find FK references: .references(() => <varName>.<col>, ...)
    // The varName here is the source-side variable name; we map back to the
    // table name by looking it up in our tables list later.
    const fkRegex = /references\(\(\)\s*=>\s*(\w+)\.(\w+)/g;
    const fks: { col: string; targetTable: string }[] = [];
    let fkMatch;
    while ((fkMatch = fkRegex.exec(body)) !== null) {
      const targetVar = fkMatch[1]!;
      // We don't know the col here without more parsing — use the var name
      // as a placeholder; the diff is which table it points to.
      fks.push({ col: "→", targetTable: targetVar });
    }

    tables.push({
      name: tableName,
      fkTargets: fks,
    });
    // Suppress unused-var warning by referencing varName
    void varName;
  }

  return tables;
}

function buildSchemaErDiagram(): string {
  const tables = parseSchemaFile();
  let md = "# Schema ER Diagram\n\n";
  md +=
    "> **Auto-generated** by `scripts/gen-api-docs.ts`. " +
    "Do not edit by hand. Run `npx tsx scripts/gen-api-docs.ts` to regenerate.\n\n";
  md += `**${tables.length} tables.**\n\n`;
  md += "## Mermaid diagram\n\n";
  md += "```mermaid\nerDiagram\n";
  for (const t of tables) {
    md += `  ${t.name} {\n    int id PK\n  }\n`;
  }
  // Build a varName→tableName lookup so FK arrows point at the right table.
  // The tables list uses tableName; the FKs reference varNames. The varName
  // is usually a camelCase of the snake_case tableName. Build the lookup.
  const varToTable = new Map<string, string>();
  const content = readFileSafe(SCHEMA_PATH);
  const reLookup = /export const (\w+) = pgTable\(\s*"([^"]+)"/g;
  let m;
  while ((m = reLookup.exec(content)) !== null) {
    varToTable.set(m[1]!, m[2]!);
  }
  for (const t of tables) {
    for (const fk of t.fkTargets) {
      const target = varToTable.get(fk.targetTable) ?? fk.targetTable;
      md += `  ${t.name} }o--|| ${target} : references\n`;
    }
  }
  md += "```\n\n";
  md += "## Tables\n\n";
  for (const t of tables.sort((a, b) => a.name.localeCompare(b.name))) {
    md += `- **${t.name}**`;
    if (t.fkTargets.length > 0) {
      const targets = t.fkTargets
        .map((fk) => varToTable.get(fk.targetTable) ?? fk.targetTable)
        .join(", ");
      md += ` → ${targets}`;
    }
    md += "\n";
  }
  return md;
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const apiCatalog = buildRouterCatalog();
  fs.writeFileSync(API_DOCS_OUT, apiCatalog);
  console.log(`Wrote ${API_DOCS_OUT} (${apiCatalog.length} bytes)`);

  const schemaDoc = buildSchemaErDiagram();
  fs.writeFileSync(SCHEMA_DOCS_OUT, schemaDoc);
  console.log(`Wrote ${SCHEMA_DOCS_OUT} (${schemaDoc.length} bytes)`);
}

main();
