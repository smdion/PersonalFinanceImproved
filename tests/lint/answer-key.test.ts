/**
 * Rules for the answer-key suites (`tests/fixtures/answer-key.ts`):
 *
 *   1. Every `it.fails(` under tests/ names the release that fixes it
 *      (`v0.11 …`; a structure fix may name a v0.10 patch, `v0.10.1 …`) in
 *      its title, so an expected failure always points at its TODO item.
 *      Titles must be literals; `xfail()` builds its own and checks its
 *      `todo` when it runs.
 *   2. `<area>/<id>` titles are unique across the `answer-key-*` files. A
 *      second test of the same case adds a suffix (`ret/P9:engine`).
 *   3. No `answer-key-*` file imports or reads a fixture from `.scratch` or
 *      `/tmp`: the key's inputs are invented households committed beside
 *      the tests (citing a `.scratch` source in a comment is fine).
 *
 * The rules are plain functions over source text, so each is also checked
 * against a planted violation below. The helpers' own behaviour is checked
 * at the end.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ANSWER_KEY_ID_PATTERN,
  XFAIL_TODO_PATTERN,
  cents,
  ledgerRow,
  runOneYear,
  xfail,
  xfailTitle,
} from "../fixtures/answer-key";
import { acct, household } from "../calculators/fixtures/two-person-household";

const TESTS_ROOT = path.resolve(__dirname, "..");
/** The helper writes `it.fails` with a built title and checks its own;
 *  this file plants violations as strings. */
const EXEMPT = new Set([
  path.join(TESTS_ROOT, "fixtures", "answer-key.ts"),
  __filename,
]);

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

const rel = (f: string) => path.relative(TESTS_ROOT, f);
const allFiles = () => [...walk(TESTS_ROOT)];
const answerKeyFiles = () =>
  allFiles().filter((f) => /answer-key-[^/]*\.test\.tsx?$/.test(f));

const lineOf = (src: string, index: number) =>
  src.slice(0, index).split("\n").length;

/** Rule 1: `it.fails` titles that are not literals or don't name a release. */
function itFailsViolations(src: string): string[] {
  const out: string[] = [];
  const call = /\b(?:it|test)\.fails\(\s*/g;
  for (const m of src.matchAll(call)) {
    const at = m.index + m[0].length;
    const quote = src[at];
    const line = lineOf(src, m.index);
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      out.push(`line ${line}: it.fails title must be a string literal`);
      continue;
    }
    const end = src.indexOf(quote, at + 1);
    const title = src.slice(at + 1, end);
    if (!/\bv0\.(1[1-9]|10\.[1-9])(\.\d+)? \S/.test(title))
      out.push(
        `line ${line}: it.fails("${title}") names no fixing release (v0.11 …)`,
      );
  }
  return out;
}

/** Rule 2: the `<area>/<id>` each case in a file is titled with. */
function caseIds(src: string): string[] {
  const ids: string[] = [];
  const title =
    /\b(?:it|test)(?:\.fails|\.todo|\.skip|\.only)?\(\s*(["'`])([a-z]+\/[^\s"'`]+)/g;
  for (const m of src.matchAll(title)) {
    // `it.todo("tax/B6: blocked on …")`: the colon ends the id.
    const id = m[2]!.replace(/:$/, "");
    if (ANSWER_KEY_ID_PATTERN.test(id)) ids.push(id);
  }
  const xfailId = /\bxfail\(\s*\{[^}]*?\bid:\s*(["'`])([a-z]+\/[^\s"'`]+)/gs;
  for (const m of src.matchAll(xfailId)) ids.push(m[2]!);
  return ids;
}

/** Rule 3: imports or file reads that reach into `.scratch` or `/tmp`. */
function outsideFixtureReads(src: string): string[] {
  const out: string[] = [];
  const reach =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\b(?:readFileSync|readFile|createReadStream|existsSync)\s*\([^)]*?)(["'`])[^"'`]*(?:\.scratch|\/tmp\/)/g;
  for (const m of src.matchAll(reach))
    out.push(`line ${lineOf(src, m.index)}: ${m[0].trim()}`);
  return out;
}

describe("answer-key rules", () => {
  it("every it.fails under tests/ names its fixing release", () => {
    const bad = allFiles()
      .filter((f) => !EXEMPT.has(f))
      .flatMap((f) =>
        itFailsViolations(fs.readFileSync(f, "utf8")).map(
          (v) => `${rel(f)} ${v}`,
        ),
      );
    expect(bad).toEqual([]);
  });

  it("<area>/<id> titles are unique across the answer-key files", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of answerKeyFiles())
      for (const id of caseIds(fs.readFileSync(f, "utf8"))) {
        const first = seen.get(id);
        if (first) dupes.push(`${id} in ${first} and ${rel(f)}`);
        else seen.set(id, rel(f));
      }
    expect(dupes).toEqual([]);
  });

  it("no answer-key file reads a fixture from .scratch or /tmp", () => {
    const bad = answerKeyFiles().flatMap((f) =>
      outsideFixtureReads(fs.readFileSync(f, "utf8")).map(
        (v) => `${rel(f)} ${v}`,
      ),
    );
    expect(bad).toEqual([]);
  });
});

describe("the rules catch planted violations", () => {
  it("an it.fails with no release in its title", () => {
    expect(itFailsViolations(`it.fails("x", () => {});`)).toHaveLength(1);
    expect(itFailsViolations(`it.fails(title, () => {});`)).toHaveLength(1);
    expect(
      itFailsViolations(
        `it.fails("tax/L2 — expected failure until v0.11 Tax \\"Unused standard deduction\\"", () => {});`,
      ),
    ).toEqual([]);
    expect(
      itFailsViolations(`it.fails("x until v0.10.1 Test every promise", f);`),
    ).toEqual([]);
    expect(
      itFailsViolations(`it.fails("x until v0.10 Tests", f);`),
    ).toHaveLength(1);
  });

  it("a duplicated case id", () => {
    const src = `
      it("tax/B2 [TAX-05] brackets", () => {});
      it.todo("tax/B6: blocked on MFS");
      xfail({ id: "tax/L2 [TAX-12]", todo: "v0.11 Tax", run, expected: 1 });
      it("ret/P9:engine", () => {});`;
    expect(caseIds(src)).toEqual([
      "tax/B2",
      "tax/B6",
      "ret/P9:engine",
      "tax/L2",
    ]);
  });

  it("a fixture read from .scratch or /tmp", () => {
    expect(
      outsideFixtureReads(`import x from "../../.scratch/docs/h.json";`),
    ).toHaveLength(1);
    expect(
      outsideFixtureReads(`const s = fs.readFileSync("/tmp/claude/x.csv");`),
    ).toHaveLength(1);
    expect(
      outsideFixtureReads(
        `// Source: .scratch/docs/reviews/2026-11-01/specs/engine.md § 16`,
      ),
    ).toEqual([]);
  });
});

describe("answer-key helpers", () => {
  it("cents holds money to half a cent, per named figure", () => {
    cents(100.004, 100);
    expect(() => cents(100.006, 100)).toThrow();
    cents({ tax: 5, net: 95.001, other: 7 }, { tax: 5, net: 95 });
    expect(() => cents({ tax: 5 }, { tax: 5, net: 95 })).toThrow(/net/);
  });

  it("ledgerRow allows $1 a flow and $1 a row so far on balances", () => {
    const row = { withdrawal: 100.9, end: 1002.5 };
    ledgerRow(
      row,
      { withdrawal: 100, end: 1000 },
      {
        row: 2,
        balanceKeys: ["end"],
      },
    );
    expect(() =>
      ledgerRow(row, { withdrawal: 100, end: 1000 }, { row: 0 }),
    ).toThrow(/end/);
    expect(() =>
      ledgerRow(row, { withdrawal: 99, end: 1002 }, { row: 0 }),
    ).toThrow(/withdrawal/);
  });

  it("xfail refuses a case that doesn't name its id or release", () => {
    const run = () => 1;
    expect(() =>
      xfail({ id: "L2", todo: "v0.11 Tax", run, expected: 2 }),
    ).toThrow(/<area>\/<id>/);
    expect(() =>
      xfail({ id: "tax/L2", todo: "later", run, expected: 2 }),
    ).toThrow(/fixing release/);
    expect(XFAIL_TODO_PATTERN.test('v0.11 Tax "One returnDeductions()"')).toBe(
      true,
    );
    expect(xfailTitle("tax/L2", "v0.11 Tax")).toBe(
      "tax/L2 — expected failure until v0.11 Tax",
    );
  });

  describe("xfail writes the decided figure as it.fails and pins today's", () => {
    // Invented: the code gives 1, the decided answer is 2.
    xfail({
      id: "lint/self-check",
      todo: "v0.11 (none: checks the helper itself)",
      run: () => 1,
      expected: 2,
      today: 1,
    });
  });

  it("runOneYear returns the asked year of a projection", () => {
    const input = household([acct("IRA", "ira", 500_000, 1)]);
    const first = runOneYear(input);
    expect(runOneYear(input, first.year).year).toBe(first.year);
    expect(() => runOneYear(input, 1900)).toThrow(/no year 1900/);
  });
});
