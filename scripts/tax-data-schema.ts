/**
 * Write what's generated from the tax-limit key list: the JSON Schemas the
 * tax-data files point to (tax-data/schema/) and the key table in
 * tax-data/README.md (src/lib/tax-data/schema.ts builds them). Run after
 * adding or renaming a key; `--check` only reports what's stale (the
 * tax-data check and a test run it).
 *
 * Usage: pnpm tax-data:schema [--check]
 */
import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import { fileURLToPath } from "url";
import { readTaxDataDir } from "../src/lib/db/reference-reconcile-core";
import {
  TAX_DATA_SCHEMA_DIR,
  buildKeyTable,
  buildTaxDataSchemas,
  withKeyTable,
} from "../src/lib/tax-data/schema";

const README = "tax-data/README.md";

/** Every generated file: path → content, formatted as the repo formats it. */
export async function generatedTaxDataFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(buildTaxDataSchemas())) {
    const file = path.join(TAX_DATA_SCHEMA_DIR, name);
    out[file] = await prettier.format(JSON.stringify(schema), {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    });
  }
  const readme = withKeyTable(
    fs.readFileSync(README, "utf8"),
    buildKeyTable(readTaxDataDir(fs)),
  );
  out[README] = await prettier.format(readme, {
    ...(await prettier.resolveConfig(README)),
    filepath: README,
  });
  return out;
}

/** Generated files that differ from what's on disk. */
export async function staleTaxDataFiles(): Promise<string[]> {
  const files = await generatedTaxDataFiles();
  return Object.entries(files)
    .filter(
      ([file, text]) =>
        !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text,
    )
    .map(([file]) => file);
}

async function main() {
  if (process.argv.includes("--check")) {
    const stale = await staleTaxDataFiles();
    if (stale.length) {
      console.error(
        `Out of date (run pnpm tax-data:schema): ${stale.join(", ")}`,
      );
      process.exit(1);
    }
    console.log("Schemas and the README key table are current. ✓");
    return;
  }
  fs.mkdirSync(TAX_DATA_SCHEMA_DIR, { recursive: true });
  for (const [file, text] of Object.entries(await generatedTaxDataFiles())) {
    fs.writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}

// Run directly (not when the check script or a test imports the helpers).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
