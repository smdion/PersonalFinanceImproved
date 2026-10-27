/**
 * Changed tax data must raise its dataVersion: installs decide what is
 * newer by that number alone (the reconcile's version guard and the
 * community sync), so two different files sharing one would let an older
 * one win. Compares the assembled data (tax-data/us-federal/, one file a
 * year) at the base ref with the working tree's.
 *
 * Usage: tsx scripts/check-tax-data-version.ts <git ref of the base>
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import {
  TAX_DATA_DIR,
  assembleTaxData,
  readTaxDataDir,
  type TaxDataFile,
} from "../src/lib/db/reference-reconcile-core";

const base = process.argv[2];
if (!base) {
  console.error("Usage: check-tax-data-version.ts <base ref>");
  process.exit(2);
}

const git = (...a: string[]) =>
  execFileSync("git", a, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/** The data at the base ref; null when the base has none in this layout
 *  (the single-file layout before it: compared by its own dataVersion). */
function atBase(): TaxDataFile | null {
  try {
    const names = git("ls-tree", "--name-only", `${base}:${TAX_DATA_DIR}`)
      .split("\n")
      .filter((n) => n.endsWith(".json"));
    return assembleTaxData(
      names.map((name) => ({
        name,
        text: git("show", `${base}:${TAX_DATA_DIR}/${name}`),
      })),
    );
  } catch {
    try {
      return JSON.parse(
        git("show", `${base}:tax-data/us-federal.json`),
      ) as TaxDataFile;
    } catch {
      return null;
    }
  }
}

const before = atBase();
if (!before) {
  console.log(`No tax data at ${base} — nothing to compare.`);
  process.exit(0);
}
const after = readTaxDataDir(fs);
const body = (f: TaxDataFile) =>
  JSON.stringify({ formatVersion: f.formatVersion, years: f.years });
if (body(before) === body(after)) {
  console.log(`${TAX_DATA_DIR} unchanged.`);
  process.exit(0);
}
if (after.dataVersion > before.dataVersion) {
  console.log(
    `${TAX_DATA_DIR} changed: dataVersion ${before.dataVersion} → ${after.dataVersion} ✓`,
  );
  process.exit(0);
}
console.error(
  `${TAX_DATA_DIR} changed but dataVersion did not increase (${before.dataVersion} → ${after.dataVersion}). Raise it by one in index.json.`,
);
process.exit(1);
