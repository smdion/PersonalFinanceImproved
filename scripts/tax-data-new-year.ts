/**
 * Start a new year: copy the latest year's file to `YYYY.json` with every
 * figure, citation and link blanked. The check refuses blanks and the
 * reconcile skips an incomplete year, so nothing from last year slips
 * through unchanged and a half-done year never reaches a database —
 * fill in each figure from its published notice, with the citation and a
 * link in `sources`. Structure (keys, filing statuses, rows) and plain-words
 * `notes` are kept. Raise dataVersion once it's filled in (CI requires it).
 *
 * It also writes the year's blank published-figures fixture,
 * `tests/fixtures/irs-published/YYYY.ts` (every figure NaN, every citation
 * empty), to key by hand from the same notices: the shipped file is
 * checked against it (tests/tax-data/irs-published.test.ts), and a
 * shipped year without one fails.
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
import type {
  FilingStatus,
  PublishedYear,
} from "../tests/fixtures/irs-published/types";

const FIXTURE_DIR = "tests/fixtures/irs-published";

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

/** The published-figures fixture for the year, shaped like the latest
 *  year's tables, with nothing filled in. */
function blankFixture(): PublishedYear {
  const statuses: FilingStatus[] = ["Single", "MFJ", "HOH"];
  const rows = <T>(n: number, row: T) => ({
    cite: "",
    value: Array.from({ length: n }, () => ({ ...row })),
  });
  const each = <T>(f: (st: FilingStatus) => T) =>
    Object.fromEntries(statuses.map((st) => [st, f(st)])) as Record<
      FilingStatus,
      T
    >;
  const table = (st: FilingStatus) =>
    from.withholding.tables[st] as
      Record<"standard" | "checkbox", { rate: number }[]> | undefined;
  const one = { value: NaN, cite: "" };
  return {
    year: Number(year),
    rateSchedule: each((st) =>
      rows(table(st)?.standard.filter((r) => r.rate !== 0).length ?? 7, {
        over: NaN,
        baseTax: NaN,
        rate: NaN,
      }),
    ),
    standardDeduction: each(() => ({ ...one })),
    agedOrBlind: { married: { ...one }, unmarried: { ...one } },
    ltcg: each(() => ({
      value: { zeroRateTop: NaN, fifteenRateTop: NaN },
      cite: "",
    })),
    withholding: each((st) => {
      const row = { atLeast: NaN, tentative: NaN, rate: NaN };
      return {
        standard: rows(table(st)?.standard.length ?? 8, row),
        checkbox: rows(table(st)?.checkbox.length ?? 8, row),
      };
    }),
    irmaa: Object.fromEntries(
      (["individual", "joint"] as const).map((col) => [
        col,
        rows(
          from.irmaa?.brackets[col === "joint" ? "MFJ" : "Single"]?.length ?? 5,
          {
            over: NaN,
            partB: NaN,
            partD: NaN,
          },
        ),
      ]),
    ) as PublishedYear["irmaa"],
    fpl: {
      value: { 1: NaN, 2: NaN, 3: NaN, 4: NaN, 5: NaN, 6: NaN, 7: NaN, 8: NaN },
      cite: "",
    },
  };
}

const fixtureText = (f: PublishedYear) => `/**
 * ${year} tax figures as published: BLANK. Key every figure (NaN) and
 * citation ("") by hand from the documents themselves, never from
 * tax-data/us-federal/${year}.json: the Rev. Proc. of ${year} inflation
 * adjustments (§ 1 rate tables, § 1(h) maximum zero and 15% rate amounts,
 * § 63(c)(2) standard deduction, § 63(f) aged-or-blind amounts) and
 * Pub 15-T (${year}) § 1 annual percentage-method tables, both columns;
 * CMS's ${year} Medicare Parts A & B fact sheet (Part B and Part D IRMAA
 * tables); HHS's ${Number(year) - 1} poverty guidelines (${year} coverage uses
 * the ones published the year before). Cite each table (document,
 * section or table, page). Then add it to
 * PUBLISHED in tests/tax-data/irs-published.test.ts; that test lists any
 * blank left.
 */
import type { PublishedYear } from "./types";

export const PUBLISHED_${year}: PublishedYear = ${JSON.stringify(
  f,
  (_k, v: unknown) =>
    typeof v === "number" && Number.isNaN(v) ? "__BLANK__" : v,
).replaceAll('"__BLANK__"', "NaN")};
`;

async function write(file: string, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  fs.writeFileSync(
    file,
    await prettier.format(text, {
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
  const fixture = path.join(FIXTURE_DIR, `${year}.ts`);
  if (fs.existsSync(fixture)) console.log(`${fixture} already exists; kept.`);
  else {
    await write(fixture, fixtureText(blankFixture()));
    console.log(`wrote ${fixture} (every published figure blank).`);
  }
  console.log(
    "Fill in each figure and its citation, add each citation's link to `sources`, raise dataVersion in index.json, then run pnpm tax-data:check.",
  );
  console.log(
    `Then key ${fixture} by hand from the same notices (not from the JSON), add it to PUBLISHED in tests/tax-data/irs-published.test.ts, and run pnpm test tests/tax-data/irs-published.test.ts: CI fails for a shipped year without it.`,
  );
}

void main();
