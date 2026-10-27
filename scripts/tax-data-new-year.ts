/**
 * Start a new year: copy the latest year's file to `YYYY.json` with every
 * figure, citation and link blanked. The check refuses blanks and the
 * reconcile skips an incomplete year, so nothing from last year slips
 * through unchanged and a half-done year never reaches a database —
 * fill in each figure from its published notice, with the citation and a
 * link in `sources`. Structure (keys, filing statuses, rows) and plain-words
 * `notes` are kept. Raise dataVersion once it's filled in (CI requires it).
 *
 * Usage: pnpm tax-data:new-year YYYY
 */
import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import {
  TAX_DATA_DIR,
  readTaxDataDir,
} from "../src/lib/db/reference-reconcile-core";

const year = process.argv[2];
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!year || !/^\d{4}$/.test(year)) fail("Usage: pnpm tax-data:new-year YYYY");

const data = readTaxDataDir(fs);
const years = Object.keys(data.years).map(Number);
const latest = Math.max(...years);
if (Number(year) <= latest)
  fail(`${year} isn't after the latest year (${latest}).`);
if (Number(year) !== latest + 1)
  console.warn(`Note: skipping from ${latest} to ${year}.`);

/** Every number in a section blanked to null (row structure kept). */
const blank = (v: unknown): unknown =>
  typeof v === "number"
    ? null
    : Array.isArray(v)
      ? v.map(blank)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]))
        : v;

const from = data.years[String(latest)]!;
/** A section without last year's citation, corrections or exception. */
const section = <S extends { source: string; notes?: string }>(
  s: S | undefined,
  body: keyof S,
) =>
  s && {
    source: "",
    ...(s.notes ? { notes: s.notes } : {}),
    [body]: blank(s[body]),
  };

// Deliberately not a valid year (blanks) — the check refuses it until filled.
const next = {
  $schema: "../schema/year.schema.json",
  revision: 1,
  source: "",
  sources: {},
  limits: Object.fromEntries(
    Object.entries(from.limits).map(([k, l]) => [
      k,
      { value: null, source: "", ...(l.notes ? { notes: l.notes } : {}) },
    ]),
  ),
  withholding: section(from.withholding, "tables"),
  ...(from.ltcg ? { ltcg: section(from.ltcg, "brackets") } : {}),
  ...(from.irmaa ? { irmaa: section(from.irmaa, "brackets") } : {}),
  ...(from.fpl ? { fpl: section(from.fpl, "amounts") } : {}),
};

async function write(file: string, value: unknown) {
  fs.writeFileSync(
    file,
    await prettier.format(JSON.stringify(value), {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    }),
  );
}

async function main() {
  const file = path.join(TAX_DATA_DIR, `${year}.json`);
  if (fs.existsSync(file)) fail(`${file} already exists.`);
  await write(file, next);
  console.log(
    `wrote ${file} (from ${latest}, every figure blank). Ledgr skips it until every figure is filled in.`,
  );
  console.log(
    "Fill in each figure and its citation, add each citation's link to `sources`, raise dataVersion in index.json, then run pnpm tax-data:check.",
  );
}

void main();
