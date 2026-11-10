/**
 * Writes scripts/abbreviation-carve-outs.json: the names
 * `ratchet/no-abbreviation` leaves alone because a stored or answered shape
 * holds them (owner Q7, v0.10.5). Each uses an abbreviation from
 * ABBREVIATIONS and is a key or identifier-like string in a stored shape (the
 * schema, json-schemas.ts, profile-fields.ts, the settings and browser-storage
 * keys, the tax-data file schema), an external API's schema, or a key of a
 * router response (any key `RouterOutputs` reaches, read with the type
 * checker, and the pinned ones in tests/baseline/__baseline__). Renaming one
 * changes a shape, so the sweep leaves it.
 *
 * Usage:  npx tsx scripts/gen-abbreviation-carve-outs.ts          (rewrite)
 *         npx tsx scripts/gen-abbreviation-carve-outs.ts --check  (exit 1 if stale)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { abbreviationIn } from "../eslint-ratchet.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CARVE_OUT_FILE = "scripts/abbreviation-carve-outs.json";

const SHAPE_DIRS = ["src/lib/db/pg", "src/lib/db/sqlite"];
const SHAPE_FILES = [
  "src/lib/db/shapes/json-schemas.ts",
  "src/lib/db/shapes/profile-fields.ts",
  "src/lib/constants/settings-keys.ts",
  "src/lib/tax-data/schema.ts",
  // External APIs' field names.
  "src/lib/budget-api/actual-schemas.ts",
  "src/lib/budget-api/ynab-schemas.ts",
  "src/lib/sec/schemas.ts",
  "src/lib/simplefin/schemas.ts",
  "src/lib/tiingo/schemas.ts",
];
const RESPONSE_DIR = "tests/baseline/__baseline__";
const TRPC_FILE = "src/lib/trpc.ts";
const NAME = /^[A-Za-z_$][\w$]*$/;

function filesIn(root: string, dir: string, ext: RegExp): string[] {
  return fs
    .readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => ext.test(f))
    .map((f) => path.join(root, dir, f))
    .sort();
}

/** Property names and identifier-like strings in a shape file. */
function shapeNames(file: string, out: Set<string>): void {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) out.add(node.text);
    else if (
      (ts.isPropertyAssignment(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodDeclaration(node)) &&
      ts.isIdentifier(node.name)
    )
      out.add(node.name.text);
    else if (ts.isShorthandPropertyAssignment(node)) out.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Every object key in a JSON value. */
function jsonKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) for (const v of value) jsonKeys(v, out);
  else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      jsonKeys(v, out);
    }
}

/** Whether a repo-relative path holds a stored or external shape. */
export function isShapeFile(file: string): boolean {
  return (
    SHAPE_FILES.includes(file) ||
    SHAPE_DIRS.some((d) => file.startsWith(`${d}/`))
  );
}

/** Every key a router's output type reaches, declared under `src/`. */
const routerKeysByRoot = new Map<string, Set<string>>();
export function routerOutputKeys(root = ROOT): Set<string> {
  const cached = routerKeysByRoot.get(root);
  if (cached) return cached;
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config,
    ts.sys,
    root,
  );
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const src = `${path.join(root, "src")}${path.sep}`;
  const inSrc = (d: ts.Declaration) =>
    path.resolve(d.getSourceFile().fileName).startsWith(src);
  const procedure = (e: ts.Expression) =>
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    /^(query|mutation|subscription)$/.test(e.expression.name.text);
  const isRoute = (d: ts.Declaration) =>
    ts.isPropertyAssignment(d) &&
    (procedure(d.initializer) ||
      (ts.isObjectLiteralExpression(d.parent) &&
        ts.isCallExpression(d.parent.parent) &&
        /^(createTRPCRouter|router)$/.test(
          d.parent.parent.expression.getText(),
        )));
  const trpc = program.getSourceFile(path.join(root, TRPC_FILE));
  const alias = trpc?.statements.find(
    (s): s is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(s) && s.name.text === "RouterOutputs",
  );
  if (!alias) throw new Error(`${TRPC_FILE} declares no RouterOutputs`);
  const names = new Set<string>();
  const seen = new Set<ts.Type>();
  const walk = (type: ts.Type, depth: number): void => {
    if (depth > 16 || seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection())
      for (const t of type.types) walk(t, depth);
    if (!(type.flags & ts.TypeFlags.Object)) return;
    for (const t of checker.getTypeArguments(type as ts.TypeReference))
      walk(t, depth + 1);
    for (const info of checker.getIndexInfosOfType(type))
      walk(info.type, depth + 1);
    for (const prop of checker.getPropertiesOfType(type)) {
      const decls = prop.declarations ?? [];
      // A router or procedure name is a route, not a key of an answer.
      if (!decls.some(isRoute) && decls.some(inSrc)) names.add(prop.name);
      if (decls.length === 0 || decls.some(inSrc))
        walk(checker.getTypeOfSymbol(prop), depth + 1);
    }
  };
  walk(checker.getTypeAtLocation(alias.name), 0);
  routerKeysByRoot.set(root, names);
  return names;
}

/**
 * Every stored, external and response key of the tree at `root`: the names a
 * proven rename (check-commit's `Rename:`, owner Q2) may not change as keys.
 * Response keys are every key a router's output type reaches, not only the
 * ones a baseline pin happens to hold.
 */
export function storedAndResponseKeys(root = ROOT): Set<string> {
  const names = new Set<string>();
  const files = [
    ...SHAPE_DIRS.flatMap((d) => filesIn(root, d, /\.ts$/)),
    ...SHAPE_FILES.map((f) => path.join(root, f)),
  ];
  for (const file of files) shapeNames(file, names);
  for (const file of filesIn(root, RESPONSE_DIR, /\.json$/))
    jsonKeys(JSON.parse(fs.readFileSync(file, "utf8")), names);
  for (const name of routerOutputKeys(root)) names.add(name);
  return new Set([...names].filter((n) => NAME.test(n)));
}

/** The carve-out list for the tree at `root`, sorted. */
export function abbreviationCarveOuts(root = ROOT): string[] {
  return [...storedAndResponseKeys(root)]
    .filter((n) => abbreviationIn(n) !== undefined)
    .sort();
}

function main() {
  const want = abbreviationCarveOuts();
  const file = path.join(ROOT, CARVE_OUT_FILE);
  if (process.argv.includes("--check")) {
    const have: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      console.error(
        `${CARVE_OUT_FILE} is stale: run npx tsx scripts/gen-abbreviation-carve-outs.ts`,
      );
      process.exit(1);
    }
    return;
  }
  fs.writeFileSync(file, `${JSON.stringify(want, null, 2)}\n`);
  console.log(`${CARVE_OUT_FILE}: ${want.length} names`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  main();
