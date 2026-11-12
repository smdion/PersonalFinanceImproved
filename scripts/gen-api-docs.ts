/**
 * Generates the API + schema docs.
 *
 * Reads src/server/routers/ and the schema (src/lib/db/schema-pg.ts) and writes:
 *   - docs/API_ROUTERS.md  — one-line summary of every tRPC procedure, by
 *     its client path, checked against tests/baseline/procedures.ts's
 *     queries; a procedure written in an index.ts fails the run
 *   - docs/SCHEMA.md       — every table's columns and keys, the relations
 *     as a mermaid diagram, jsonb shapes and the schema version
 *     (scripts/gen-schema-docs.ts)
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
import ts from "typescript";
import { generateSchemaDoc } from "./gen-schema-docs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ROUTERS_DIR = path.join(ROOT, "src/server/routers");
const BASELINE_PROCEDURES = path.join(ROOT, "tests/baseline/procedures.ts");

const API_DOCS_OUT = path.join(ROOT, "docs/API_ROUTERS.md");
const SCHEMA_DOCS_OUT = path.join(ROOT, "docs/SCHEMA.md");

// ── Router catalog ───────────────────────────────────────────────────
//
// Read with the TypeScript parser from the root router down, the way tRPC
// mounts it: `createTRPCRouter({...})` nests by key, a spread and
// `mergeRouters(...)` add their procedures at the same level, and an
// identifier is followed to its declaration (in the file or through its
// import). Each procedure is listed under the client path it's called by.

interface ProcedureEntry {
  /** The client path, e.g. `people.list`. */
  path: string;
  /** The router it's mounted under in the root router, e.g. `settings`. */
  router: string;
  /** The file it's written in, relative to the routers folder. */
  source: string;
  kind: "query" | "mutation";
  procType: string; // "protectedProcedure", "adminProcedure", etc.
  /** Its doc comment's text, or "" when it has none. */
  description: string;
}

const parsed = new Map<string, ts.SourceFile>();
function sourceFile(file: string): ts.SourceFile {
  let sf = parsed.get(file);
  if (!sf) {
    if (!fs.existsSync(file)) throw new Error(`gen-api-docs: no file ${file}`);
    sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    parsed.set(file, sf);
  }
  return sf;
}

function resolveImport(fromFile: string, spec: string): string {
  if (!spec.startsWith(".")) {
    throw new Error(`gen-api-docs: ${fromFile} imports a router from ${spec}`);
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  return fs.existsSync(`${base}.ts`)
    ? `${base}.ts`
    : path.join(base, "index.ts");
}

function where(file: string, node: ts.Node): string {
  const sf = sourceFile(file);
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  return `${file}:${line}`;
}

/** The expression a name stands for: its `const` in the file, or the
 *  exported `const` of the file it's imported from. */
function declarationOf(
  file: string,
  name: string,
): { file: string; init: ts.Expression } {
  const sf = sourceFile(file);
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
          return { file, init: d.initializer };
        }
      }
    }
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings)
    ) {
      for (const el of st.importClause.namedBindings.elements) {
        if (el.name.text === name) {
          const imported = (el.propertyName ?? el.name).text;
          return declarationOf(
            resolveImport(file, st.moduleSpecifier.text),
            imported,
          );
        }
      }
    }
  }
  throw new Error(`gen-api-docs: can't find ${name} from ${file}`);
}

/** `x.input(...).query(...)` → its kind and the procedure it starts from. */
function procedureCall(
  expr: ts.Expression,
): { kind: "query" | "mutation"; procType: string } | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (method !== "query" && method !== "mutation") return null;
  let base: ts.Expression = callee.expression;
  while (ts.isCallExpression(base) || ts.isPropertyAccessExpression(base)) {
    base = base.expression;
  }
  return { kind: method, procType: ts.isIdentifier(base) ? base.text : "?" };
}

/** A `// ══ SECTION ══` banner: it heads a group, it doesn't describe one. */
const BANNER = /^\/\/\s*═+.*═+$/;

/** The doc comment just above a procedure's first line, whole: a block
 *  comment from its opening line, or a run of `//` lines below any banner. */
function descriptionAbove(lines: string[], i: number): string {
  const trimmed = (k: number) => lines[k]!.trim();
  if (i > 0 && trimmed(i - 1).endsWith("*/")) {
    let start = i - 1;
    while (start >= 0 && !trimmed(start).startsWith("/*")) {
      if (!trimmed(start).startsWith("*")) return ""; // closes code's comment
      start--;
    }
    if (start < 0) return "";
    return lines
      .slice(start, i)
      .map((line) =>
        line
          .trim()
          .replace(/^\/\*\*?/, "")
          .replace(/\*\/$/, "")
          .replace(/^\*\s?/, "")
          .trim(),
      )
      .filter((text) => text !== "" && !text.startsWith("@"))
      .join(" ");
  }
  let k = i;
  while (
    k > 0 &&
    trimmed(k - 1).startsWith("//") &&
    !BANNER.test(trimmed(k - 1))
  )
    k--;
  return lines
    .slice(k, i)
    .map((line) => line.trim().slice(2).trim())
    .join(" ");
}

function propertyKey(file: string, name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  throw new Error(`gen-api-docs: computed router key at ${where(file, name)}`);
}

interface CollectContext {
  routersDir: string;
  entries: ProcedureEntry[];
  errors: string[];
}

function collect(
  ctx: CollectContext,
  file: string,
  expr: ts.Expression,
  prefix: string[],
): void {
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    expr = expr.expression;
  }
  if (ts.isIdentifier(expr)) {
    const d = declarationOf(file, expr.text);
    collect(ctx, d.file, d.init, prefix);
    return;
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const fn = expr.expression.text;
    if (fn === "createTRPCRouter" && expr.arguments.length === 1) {
      collect(ctx, file, expr.arguments[0]!, prefix);
      return;
    }
    if (fn === "mergeRouters") {
      for (const arg of expr.arguments) collect(ctx, file, arg, prefix);
      return;
    }
  }
  if (!ts.isObjectLiteralExpression(expr)) {
    throw new Error(
      `gen-api-docs: can't read the router at ${where(file, expr)}`,
    );
  }
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      collect(ctx, file, prop.expression, prefix);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      collect(ctx, file, prop.name, [...prefix, prop.name.text]);
    } else if (ts.isPropertyAssignment(prop)) {
      const key = propertyKey(file, prop.name);
      const proc = procedureCall(prop.initializer);
      if (!proc) {
        collect(ctx, file, prop.initializer, [...prefix, key]);
        continue;
      }
      const clientPath = [...prefix, key].join(".");
      if (path.basename(file) === "index.ts") {
        ctx.errors.push(
          `${where(file, prop)}: ${clientPath} is written in an index.ts; ` +
            "a group's index only combines its parts, so move it to a part file",
        );
      }
      const sf = sourceFile(file);
      const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line;
      ctx.entries.push({
        path: clientPath,
        router: prefix[0] ?? key,
        source: path.relative(ctx.routersDir, file).replace(/\\/g, "/"),
        kind: proc.kind,
        procType: proc.procType,
        description: descriptionAbove(sf.text.split("\n"), line),
      });
    } else {
      throw new Error(
        `gen-api-docs: can't read the router at ${where(file, prop)}`,
      );
    }
  }
}

/** Every procedure under the root router's `appRouter`, by client path. */
export function readRouterCatalog(routersDir: string): ProcedureEntry[] {
  parsed.clear();
  const ctx: CollectContext = { routersDir, entries: [], errors: [] };
  const root = path.join(routersDir, "index.ts");
  const app = declarationOf(root, "appRouter");
  collect(ctx, app.file, app.init, []);
  if (ctx.errors.length > 0) throw new Error(ctx.errors.join("\n"));
  return ctx.entries;
}

/** The queries the behavior baseline calls or skips by name; its suites
 *  check that list against the app router's own, so a client path read
 *  wrong here fails the run. */
function baselineQueryPaths(file: string): Set<string> {
  const sf = sourceFile(file);
  const paths = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      if (d.name.text === "PROCEDURES") {
        // Any `path: "..."` inside, including the ones a `.map` builds.
        const visit = (node: ts.Node): void => {
          if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === "path" &&
            ts.isStringLiteral(node.initializer)
          ) {
            paths.add(node.initializer.text);
          }
          ts.forEachChild(node, visit);
        };
        visit(d.initializer);
      }
      if (
        d.name.text === "SKIPPED" &&
        ts.isObjectLiteralExpression(d.initializer)
      ) {
        for (const p of d.initializer.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name)) {
            paths.add(p.name.text);
          }
        }
      }
    }
  }
  return paths;
}

function checkAgainstBaseline(entries: ProcedureEntry[], file: string): void {
  const expected = baselineQueryPaths(file);
  const read = new Set(
    entries.filter((e) => e.kind === "query").map((e) => e.path),
  );
  const missing = [...expected].filter((p) => !read.has(p)).sort();
  const extra = [...read].filter((p) => !expected.has(p)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "gen-api-docs: the client paths read from the routers don't match " +
        `${path.relative(ROOT, file)}'s queries.\n` +
        (missing.length ? `  not read: ${missing.join(", ")}\n` : "") +
        (extra.length ? `  not in the baseline: ${extra.join(", ")}\n` : ""),
    );
  }
}

export function buildRouterCatalog(
  routersDir: string,
  baselineFile: string | null,
): string {
  const allEntries = readRouterCatalog(routersDir);
  if (baselineFile) checkAgainstBaseline(allEntries, baselineFile);

  // Group by mounted router
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
  md +=
    "Each procedure is listed by its client path (`trpc.<path>`); Source is " +
    "its file under `src/server/routers/`.\n\n";
  md += "Procedure type tags: `protectedProcedure` (any signed-in user), ";
  md +=
    "`adminProcedure` (admin role), `<domain>Procedure` (permission-scoped), ";
  md += "`publicProcedure` (no auth).\n\n";

  const sortedRouters = Array.from(byRouter.keys()).sort();
  for (const router of sortedRouters) {
    md += `## \`${router}\`\n\n`;
    const procs = byRouter.get(router)!;
    procs.sort((a, b) => a.path.localeCompare(b.path));
    // The Description column only where a procedure has a doc comment.
    const described = procs.some((p) => p.description !== "");
    md += `| Procedure | Kind | Auth | Source |${described ? " Description |" : ""}\n`;
    md += `|---|---|---|---|${described ? "---|" : ""}\n`;
    for (const p of procs) {
      const desc = p.description.replace(/\|/g, "\\|");
      md += `| \`${p.path}\` | ${p.kind} | \`${p.procType}\` | \`${p.source}\` |${described ? ` ${desc} |` : ""}\n`;
    }
    md += "\n";
  }

  return md;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const apiCatalog = buildRouterCatalog(ROUTERS_DIR, BASELINE_PROCEDURES);
  fs.writeFileSync(API_DOCS_OUT, apiCatalog);
  console.log(`Wrote ${API_DOCS_OUT} (${apiCatalog.length} bytes)`);

  const schemaDoc = await generateSchemaDoc(ROOT);
  fs.writeFileSync(SCHEMA_DOCS_OUT, schemaDoc);
  console.log(`Wrote ${SCHEMA_DOCS_OUT} (${schemaDoc.length} bytes)`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
