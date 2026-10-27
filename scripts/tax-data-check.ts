/**
 * Check the tax data on its own — seconds, no database, no `.env`: every
 * file parses, the assembled data passes every check CI and the app run
 * (src/lib/tax-data/validate.ts), and the generated schemas and README key
 * table are current. Run it before opening a pull request.
 *
 * Usage: pnpm tax-data:check
 */
import * as fs from "fs";
import {
  TAX_DATA_DIR,
  assembleTaxData,
} from "../src/lib/db/reference-reconcile-core";
import { validateTaxDataFile } from "../src/lib/tax-data/validate";
import { staleTaxDataFiles } from "./tax-data-schema";

async function main() {
  const problems: string[] = [];
  const files = fs
    .readdirSync(TAX_DATA_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((name) => ({
      name,
      text: fs.readFileSync(`${TAX_DATA_DIR}/${name}`, "utf8"),
    }));
  for (const f of files)
    try {
      JSON.parse(f.text);
    } catch (e) {
      problems.push(`${f.name}: not valid JSON (${(e as Error).message})`);
    }
  if (problems.length === 0) {
    try {
      const data = assembleTaxData(files);
      problems.push(...validateTaxDataFile(data));
      if (problems.length === 0)
        console.log(
          `${TAX_DATA_DIR}: ${Object.keys(data.years).join(", ")} — dataVersion ${data.dataVersion}`,
        );
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  for (const f of await staleTaxDataFiles())
    problems.push(`${f} is out of date — run pnpm tax-data:schema`);

  if (problems.length) {
    console.error(
      `✗ ${problems.length} problem(s):\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log("✓ Tax data passes every check.");
}

void main();
