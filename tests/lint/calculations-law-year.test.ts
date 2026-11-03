/**
 * Tax law keeps the app and the tests current (owner, 2026-11-03). New
 * figures each year aren't enough: the law moves too (deductions, credits,
 * phase-outs, sunsets, ages). So:
 *
 *   1. Every tax-law row of docs/CALCULATIONS.md says which tax year it was
 *      last checked against the law (its `Checked for` column), and a row
 *      counts as tax law by the rule "How to read a row" states.
 *   2. No tax-law row is checked for an older year than the newest
 *      `tax-data/us-federal/<year>.json`: shipping a year's figures forces
 *      a pass over that year's law.
 *   3. Every shipped tax year has a passing, hand-worked whole-return case
 *      for each filing status its tables ship, in
 *      `tests/calculators/answer-key-tax*.test.ts`, titled with a
 *      `{return <year> <status>}` tag.
 *
 * The rules are plain functions, each also checked against planted
 * violations below.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  CALCULATIONS_DOC,
  answerKeyCasesIn,
  registerRows,
  testedCells,
  type AnswerKeyCase,
  type RegisterRow,
} from "../../scripts/calculations-tested";

const ROOT = path.resolve(__dirname, "../..");
const TAX_DATA = path.join(ROOT, "tax-data/us-federal");

/**
 * An Authority that cites federal tax or benefit law: the IRC, Treasury
 * regulations, an IRS publication, form, schedule, instructions, notice or
 * revenue procedure, a public law, the U.S. Code or CFR, or a CMS, SSA or
 * HHS notice. (An SEC form isn't tax law.) Same rule as CALCULATIONS'
 * "How to read a row".
 */
const TAX_LAW =
  /\b(?:IRC|Treas\. Reg|Rev\. Proc|Notice 20\d\d|Pub \d+|(?<!SEC )Form [\dW]|Schedule [\dA-Z]|[Ii]nstructions|P\.L\.|USC|CFR|CMS|SSA|HHS|POMS)/;

const NOT_CHECKED = "Not checked";
const NOT_LAW = "—";

/**
 * Tax-law rows no review has read against the law yet (November 2026
 * review: LIM-14 and LIM-28 are Unverified; ENG-20's IRC 1012 wasn't
 * fetched). Allowed only through `through`: once a newer tax year ships,
 * they fail with the rest. Check each, set its year, and remove it here.
 */
const NOT_YET_CHECKED = {
  through: 2026,
  rows: ["LIM-14", "LIM-28", "ENG-20"],
} as const;

const HOW_TO =
  "Check the law, not just the figures (tax-data/README.md § Adding a year; " +
  "docs/CALCULATIONS.md § Tax law, every year)";

// ── The rules ───────────────────────────────────────────────────────────

/** Rule 1: a row's `Checked for` doesn't match whether it's tax law. */
function checkedForViolations(rows: RegisterRow[]): string[] {
  const out: string[] = [];
  for (const { cells } of rows) {
    const id = cells.Id;
    const value = cells["Checked for"];
    if (value === undefined) {
      out.push(`${id}: its table has no "Checked for" column`);
      continue;
    }
    const law = TAX_LAW.test(cells.Authority ?? "");
    if (law && value !== NOT_CHECKED && !/^\d{4}$/.test(value))
      out.push(
        `${id}: its Authority cites tax law, so "Checked for" must be the tax year its law was last checked against (or "${NOT_CHECKED}"), not "${value}"`,
      );
    if (!law && value !== NOT_LAW)
      out.push(
        `${id}: its Authority cites no tax law, so "Checked for" is "${NOT_LAW}", not "${value}" (or name the law in Authority)`,
      );
  }
  return out;
}

/** Rule 2: tax-law rows checked for an older year than `newest`. */
function staleLawRows(
  rows: RegisterRow[],
  newest: number,
  allowed: { through: number; rows: readonly string[] } = NOT_YET_CHECKED,
): string[] {
  const stale: string[] = [];
  for (const { cells } of rows) {
    const value = cells["Checked for"] ?? "";
    if (!TAX_LAW.test(cells.Authority ?? "")) continue;
    if (value === NOT_CHECKED) {
      if (!(allowed.rows.includes(cells.Id!) && newest <= allowed.through))
        stale.push(`${cells.Id} (${NOT_CHECKED.toLowerCase()})`);
    } else if (Number(value) < newest) stale.push(`${cells.Id} (${value})`);
  }
  return stale;
}

/** Rows on the not-yet-checked list that now carry a year. */
function staleAllowance(
  rows: RegisterRow[],
  allowed: { rows: readonly string[] } = NOT_YET_CHECKED,
): string[] {
  return rows
    .filter(
      (r) =>
        allowed.rows.includes(r.cells.Id!) &&
        r.cells["Checked for"] !== NOT_CHECKED,
    )
    .map((r) => r.cells.Id!);
}

const RETURN_TAG = /\{return (\d{4}) (\w+)\}/;

/** Rule 3: `<year> <status>` pairs with no passing whole-return case. */
function missingWholeReturns(
  cases: AnswerKeyCase[],
  shipped: Readonly<Record<number, readonly string[]>>,
): string[] {
  const have = new Set(
    cases
      .filter((c) => c.kind === "pass")
      .map((c) => c.title.match(RETURN_TAG))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => `${m[1]} ${m[2]}`),
  );
  return Object.entries(shipped).flatMap(([year, statuses]) =>
    statuses.map((s) => `${year} ${s}`).filter((pair) => !have.has(pair)),
  );
}

// ── The repo ────────────────────────────────────────────────────────────

/** Each shipped tax year and the filing statuses its tables ship. */
function shippedYears(): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const f of fs.readdirSync(TAX_DATA)) {
    const m = f.match(/^(\d{4})\.json$/);
    if (!m) continue;
    const year = JSON.parse(fs.readFileSync(path.join(TAX_DATA, f), "utf8"));
    out[Number(m[1])] = Object.keys(year.withholding?.tables ?? {});
  }
  return out;
}

const rows = registerRows(
  fs.readFileSync(path.join(ROOT, CALCULATIONS_DOC), "utf8"),
);
const shipped = shippedYears();
const newest = Math.max(...Object.keys(shipped).map(Number));

function taxAnswerKeyCases(): AnswerKeyCase[] {
  const dir = path.join(ROOT, "tests/calculators");
  return fs
    .readdirSync(dir)
    .filter((f) => /^answer-key-tax.*\.test\.tsx?$/.test(f))
    .flatMap((f) =>
      answerKeyCasesIn(
        fs.readFileSync(path.join(dir, f), "utf8"),
        `calculators/${f}`,
      ),
    );
}

describe("tax law is kept current", () => {
  it("the register has its rows", () => {
    expect(rows.length).toBeGreaterThan(200);
  });

  it("every tax-law row of CALCULATIONS says which tax year it was checked for", () => {
    expect(checkedForViolations(rows)).toEqual([]);
  });

  it(`every tax-law row is checked for the newest shipped tax year (${newest})`, () => {
    const stale = staleLawRows(rows, newest);
    expect(
      stale,
      `tax-data/us-federal/${newest}.json ships, but these tax-law rows of ${CALCULATIONS_DOC} were last checked for an older year: ${stale.join(", ")}. ` +
        `${HOW_TO}: read what changed in the law for ${newest}; read each row's Authority against it; where the law changed, fix the row's Function and re-work its answer-key cases (the Tested column names them), and add cases for a new rule; then set the row's "Checked for" to ${newest}.`,
    ).toEqual([]);
  });

  it("the not-yet-checked list names only rows still not checked", () => {
    const done = staleAllowance(rows);
    expect(
      done,
      `${done.join(", ")} now carry a checked year: remove them from NOT_YET_CHECKED in this file.`,
    ).toEqual([]);
  });

  it("every shipped tax year has a passing whole-return case for each filing status", () => {
    const missing = missingWholeReturns(taxAnswerKeyCases(), shipped);
    expect(
      missing,
      `No passing hand-worked whole return for: ${missing.join(", ")}. ` +
        `Add one per year and status to tests/calculators/answer-key-tax.test.ts § whole returns: ` +
        `work it by hand from that year's published tables (rate schedule, standard deduction and add-ons, gains thresholds, Pub 915 for Social Security), ` +
        `write the working and citations beside the figure, and title it "tax/<id> [TAX-nn] {return <year> <status>} …". ` +
        `If the code gets it wrong, keep the worked figure as an xfail and add a passing case it does get right.`,
    ).toEqual([]);
  });
});

describe("the Tested generator reads planted titles", () => {
  it("counts cases, and marks a loop-built or untitled check as a table check", () => {
    const src = `
      it("tax/B2 [TAX-05] brackets", () => {});
      it.fails("tax/L2 [TAX-16] x — expected failure until v0.11 Tax", () => {});
      xfail({ id: "tax/L3 [TAX-16]", todo: "v0.11 Tax", run, expected: 0 });
      it(\`\${id}:std [TAX-03] \${st} standard deduction\`, () => {});
      it("returns the published divisor at every age [RET-02]", () => {});
      it.todo("tax/B6 [TAX-05]: blocked");
      it("tax/B1 untagged", () => {});
      if (re.test("tax/X [TAX-09]")) {}`;
    const cells = testedCells(answerKeyCasesIn(src, "f.test.ts"));
    expect(Object.fromEntries(cells)).toEqual({
      "TAX-05": "\`f.test.ts\`: 1 passing",
      "TAX-16": "\`f.test.ts\`: 2 expected failures",
      "TAX-03": "\`f.test.ts\`: table check",
      "RET-02": "\`f.test.ts\`: table check",
    });
  });
});

describe("the rules catch planted violations", () => {
  const row = (id: string, authority: string, checked: string) => ({
    line: 1,
    cells: { Id: id, Authority: authority, "Checked for": checked },
  });

  it("a tax-law row with no year, and a year on a row that isn't tax law", () => {
    expect(
      checkedForViolations([
        row("TAX-01", "IRC § 1; Rev. Proc. 2025-32", "2026"),
        row("TAX-02", "Pub 915 (2025) Worksheet 1", "—"),
        row("HH-01", "Owner design (RULES § X)", "2026"),
        row("HH-02", "SEC Form N-PORT", "—"),
        row("HH-03", "Arithmetic", "—"),
      ]),
    ).toEqual([
      expect.stringContaining("TAX-02"),
      expect.stringContaining("HH-01"),
    ]);
  });

  it("a row checked for an older year, and the not-yet-checked list's end", () => {
    const rows = [
      row("TAX-01", "IRC § 1", "2026"),
      row("TAX-02", "IRC § 63", "2025"),
      row("LIM-14", "IRC § 408(d)(2)", "Not checked"),
      row("HH-01", "Owner design", "—"),
    ];
    const allowed = { through: 2026, rows: ["LIM-14"] };
    expect(staleLawRows(rows, 2026, allowed)).toEqual(["TAX-02 (2025)"]);
    expect(staleLawRows(rows, 2027, allowed)).toEqual([
      "TAX-01 (2026)",
      "TAX-02 (2025)",
      "LIM-14 (not checked)",
    ]);
    expect(
      staleAllowance([row("LIM-14", "IRC", "2027")], { rows: ["LIM-14"] }),
    ).toEqual(["LIM-14"]);
  });

  it("a year and status with no passing whole return", () => {
    const cases = answerKeyCasesIn(
      `
      it("tax/X1 [TAX-16] {return 2026 MFJ} both 67", () => {});
      it("tax/X2 [TAX-16] 2026 Single, untagged", () => {});
      xfail({ id: "tax/X3 [TAX-16] {return 2026 HOH}", todo: "v0.11 Tax", run, expected: 0 });`,
      "calculators/answer-key-tax.test.ts",
    );
    expect(
      missingWholeReturns(cases, { 2026: ["MFJ", "Single", "HOH"] }),
    ).toEqual(["2026 Single", "2026 HOH"]);
  });
});
