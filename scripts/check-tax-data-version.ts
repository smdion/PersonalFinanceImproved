/**
 * A changed tax-data file must raise its dataVersion: installs decide what
 * is newer by that number alone (the reconcile's version guard and the
 * community sync), so two different files sharing one would let an older
 * one win.
 *
 * Usage: tsx scripts/check-tax-data-version.ts <git ref of the base>
 */
import { execFileSync } from "child_process";
import * as fs from "fs";

const FILE = "tax-data/us-federal.json";
const base = process.argv[2];
if (!base) {
  console.error("Usage: check-tax-data-version.ts <base ref>");
  process.exit(2);
}

let before: string;
try {
  before = execFileSync("git", ["show", `${base}:${FILE}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.log(`No ${FILE} at ${base} — nothing to compare.`);
  process.exit(0);
}
const after = fs.readFileSync(FILE, "utf8");
if (before === after) {
  console.log(`${FILE} unchanged.`);
  process.exit(0);
}
const v = (text: string) =>
  (JSON.parse(text) as { dataVersion: number }).dataVersion;
if (v(after) > v(before)) {
  console.log(`${FILE} changed: dataVersion ${v(before)} → ${v(after)} ✓`);
  process.exit(0);
}
console.error(
  `${FILE} changed but dataVersion did not increase (${v(before)} → ${v(after)}). Raise it by one.`,
);
process.exit(1);
