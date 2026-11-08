/**
 * Writes scripts/abbreviation-carve-outs.json: the names
 * `ratchet/no-abbreviation` leaves alone because a stored or answered shape
 * holds them (owner Q7, v0.10.5). Each uses an abbreviation from
 * ABBREVIATIONS and is a key or identifier-like string in a stored shape (the
 * schema, json-schemas.ts, profile-fields.ts, the settings and browser-storage
 * keys, the tax-data file schema), an external API's schema, or a key of a
 * router response in tests/baseline/__baseline__. Renaming one changes a
 * shape, so the sweep leaves it.
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
  "src/lib/db/json-schemas.ts",
  "src/lib/db/profile-fields.ts",
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

/** The carve-out list for the tree at `root`, sorted. */
export function abbreviationCarveOuts(root = ROOT): string[] {
  const names = new Set<string>();
  const files = [
    ...SHAPE_DIRS.flatMap((d) => filesIn(root, d, /\.ts$/)),
    ...SHAPE_FILES.map((f) => path.join(root, f)),
  ];
  for (const file of files) shapeNames(file, names);
  for (const file of filesIn(root, RESPONSE_DIR, /\.json$/))
    jsonKeys(JSON.parse(fs.readFileSync(file, "utf8")), names);
  return [...names]
    .filter((n) => NAME.test(n) && abbreviationIn(n) !== undefined)
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
