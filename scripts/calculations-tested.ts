/**
 * docs/CALCULATIONS.md's generated parts and its path check.
 *
 * - The **Tested** column: for each row, the test files whose answer-key
 *   case titles carry the row's id (`tax/B2 [TAX-05] …`) and how many of
 *   those cases pass and how many are expected failures (`it.fails` /
 *   `xfail`).
 *   It's read from the test titles, never written by hand.
 * - Every `Function` entry (`path:symbol`, path under `src/` or a
 *   `tax-data/` file) and every `Test` path (under `tests/`) must exist,
 *   with the symbol defined in that file. A bare symbol is in the file
 *   named before it in the same cell.
 * - Every row id a case title carries must be a row of the register.
 *
 * Usage: tsx scripts/calculations-tested.ts [--update]
 *   (`pnpm docs:update` rewrites the column; `pnpm docs:verify` checks it)
 */
import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CALCULATIONS_DOC = "docs/CALCULATIONS.md";

// ── The answer-key cases ────────────────────────────────────────────────

/**
 * `pass` / `xfail`: an answer-key case. `check`: a table check that carries
 * a literal `[ROW-ID]` but isn't one countable case (its title is built in
 * a loop, or doesn't start `<area>/<id>`), e.g. every published cell.
 */
export type AnswerKeyKind = "pass" | "xfail" | "check";

export interface AnswerKeyCase {
  /** Path under `tests/`. */
  file: string;
  /** The whole title (for an `xfail`, its `id`). */
  title: string;
  /** `<area>/<id>`. */
  id: string;
  /** The CALCULATIONS row, from `[ROW-ID]`. */
  row: string;
  kind: AnswerKeyKind;
}

const ROW_TAG = /\[([A-Z]{2,4}-\d{2,3})\]/;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* walk(full);
    } else yield full;
  }
}

/** A string literal starting at `src[at]` (its quote), escapes kept. */
function literalAt(src: string, at: number): string | null {
  const quote = src[at];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let i = at + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
  return src.slice(at + 1, i);
}

/**
 * The cases one answer-key file writes. A plain `it`/`test` passes; an
 * `it.fails` or an `xfail({ id })` is an expected failure (the `xfail`'s
 * pin of today's figure is part of the same case), and so is an `id:`
 * field outside an `xfail` (a table of cases a loop turns into tests).
 * `it.todo`, `it.skip` and `describe` titles aren't cases, and a title
 * with no literal `[ROW-ID]` isn't counted. A tagged title built in a
 * loop (`${…}`, an unknown number of tests) or not starting `<area>/<id>`
 * is a table check: it marks the row tested without a count.
 */
export function answerKeyCasesIn(src: string, file: string): AnswerKeyCase[] {
  const out: AnswerKeyCase[] = [];
  const push = (title: string, kind: AnswerKeyKind) => {
    const row = title.match(ROW_TAG)?.[1];
    if (!row) return;
    const id = title.split(" ")[0]!;
    const countable = !title.includes("${") && /^[a-z]+\/\S/.test(id);
    out.push({ file, title, id, row, kind: countable ? kind : "check" });
  };
  for (const m of src.matchAll(
    /(?<![.\w])(?:it|test)(\.fails|\.only)?\(\s*/g,
  )) {
    const title = literalAt(src, m.index + m[0].length);
    if (title !== null) push(title, m[1] === ".fails" ? "xfail" : "pass");
  }
  const xfailIds = new Set<number>();
  for (const m of src.matchAll(/\bxfail\(\s*\{[^}]*?\bid:\s*/gs)) {
    const at = m.index + m[0].length;
    xfailIds.add(at);
    const title = literalAt(src, at);
    if (title !== null) push(title, "xfail");
  }
  // A table of cases a loop turns into tests, each with its `id`.
  for (const m of src.matchAll(/\bid:\s*/g)) {
    const at = m.index + m[0].length;
    if (xfailIds.has(at)) continue;
    const title = literalAt(src, at);
    if (title !== null && /^[a-z]+\//.test(title)) push(title, "pass");
  }
  return out;
}

/**
 * Every answer-key case under `tests/`: the `answer-key-*` files, and the
 * cases titled the same way in other test files (the published-table and
 * per-status checks). `tests/lint/` plants fake ones, so it's skipped.
 */
export function answerKeyCases(root = ROOT): AnswerKeyCase[] {
  const tests = path.join(root, "tests");
  const lint = path.join(tests, "lint") + path.sep;
  return [...walk(tests)]
    .filter((f) => /\.test\.tsx?$/.test(f) && !f.startsWith(lint))
    .sort()
    .flatMap((f) =>
      answerKeyCasesIn(
        fs.readFileSync(f, "utf8"),
        path.relative(tests, f).split(path.sep).join("/"),
      ),
    );
}

/** The Tested cell for each row id that has a case. */
export function testedCells(cases: AnswerKeyCase[]): Map<string, string> {
  const byRow = new Map<string, Map<string, Record<AnswerKeyKind, number>>>();
  for (const c of cases) {
    const files = byRow.get(c.row) ?? new Map();
    const n = files.get(c.file) ?? { pass: 0, xfail: 0, check: 0 };
    n[c.kind]++;
    files.set(c.file, n);
    byRow.set(c.row, files);
  }
  const cells = new Map<string, string>();
  for (const [row, files] of byRow) {
    const parts = [...files].map(([file, n]) => {
      const counts = [
        n.pass && `${n.pass} passing`,
        n.xfail &&
          `${n.xfail} expected ${n.xfail === 1 ? "failure" : "failures"}`,
        n.check && "table check",
      ].filter(Boolean);
      return `\`${file}\`: ${counts.join(", ")}`;
    });
    cells.set(row, parts.join("; "));
  }
  return cells;
}

// ── The register's tables ───────────────────────────────────────────────

/** Split a markdown table line into trimmed cells (`\|` stays in a cell). */
export function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

export interface RegisterRow {
  /** 1-based line in the doc. */
  line: number;
  cells: Record<string, string>;
}

/** Every row of every register table (a table whose header starts `Id`). */
export function registerRows(doc: string): RegisterRow[] {
  const rows: RegisterRow[] = [];
  let header: string[] | null = null;
  doc.split("\n").forEach((line, i) => {
    if (!line.startsWith("|")) {
      header = null;
      return;
    }
    const cells = tableCells(line);
    if (!header) {
      if (cells[0] === "Id") header = cells;
      return;
    }
    if (/^-+$/.test(cells[0]!.replace(/:/g, ""))) return;
    const h = header;
    rows.push({
      line: i + 1,
      cells: Object.fromEntries(h.map((name, j) => [name, cells[j] ?? ""])),
    });
  });
  return rows;
}

/** The doc with each Tested cell set from `cells` ("None" for no case). */
export function withTestedColumn(
  doc: string,
  cells: Map<string, string>,
): string {
  let header: string[] | null = null;
  return doc
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) {
        header = null;
        return line;
      }
      const row = tableCells(line);
      if (!header) {
        if (row[0] === "Id") header = row;
        return line;
      }
      const at = header.indexOf("Tested");
      if (at < 0 || /^-+$/.test(row[0]!.replace(/:/g, ""))) return line;
      row[at] = cells.get(row[0]!) ?? "None";
      return `| ${row.join(" | ")} |`;
    })
    .join("\n");
}

/** CALCULATIONS.md as `pnpm docs:update` writes it. */
export async function generatedCalculationsDoc(root = ROOT): Promise<string> {
  const file = path.join(root, CALCULATIONS_DOC);
  const doc = withTestedColumn(
    fs.readFileSync(file, "utf8"),
    testedCells(answerKeyCases(root)),
  );
  return prettier.format(doc, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
}

// ── Paths ───────────────────────────────────────────────────────────────

const CODE = /`([^`]+)`/g;
const FILE_REF = /^((?:[\w.@()[\]-]+\/)*[\w.@()[\]-]+\.(?:tsx?|json)):?(\w*)$/;

function definesSymbol(src: string, sym: string): boolean {
  return new RegExp(
    String.raw`\b(?:function\*?|const|let|var|class|type|interface|enum)\s+${sym}\b` +
      String.raw`|^\s*(?:async\s+)?${sym}\s*[:(]` +
      String.raw`|export\s*\{[^}]*\b${sym}\b` +
      String.raw`|"${sym}"\s*:`,
    "m",
  ).test(src);
}

/** Function and Test entries that don't exist on disk. */
export function missingPaths(doc: string, root = ROOT): string[] {
  const out: string[] = [];
  for (const { line, cells } of registerRows(doc)) {
    const id = cells.Id;
    let file: string | null = null;
    for (const [, code] of (cells.Function ?? "").matchAll(CODE)) {
      const ref = code!.match(FILE_REF);
      let sym: string;
      if (ref) {
        const rel = ref[1]!.startsWith("tax-data/") ? ref[1]! : `src/${ref[1]}`;
        file = path.join(root, rel);
        sym = ref[2]!;
        if (!fs.existsSync(file)) {
          out.push(`${id} (line ${line}): Function \`${code}\`: no ${rel}`);
          file = null;
          continue;
        }
      } else if (/^\w+$/.test(code!)) {
        sym = code!;
        if (!file) {
          out.push(`${id} (line ${line}): Function \`${code}\` names no file`);
          continue;
        }
      } else continue;
      if (sym && !definesSymbol(fs.readFileSync(file, "utf8"), sym))
        out.push(
          `${id} (line ${line}): Function \`${code}\`: ${sym} isn't defined in ${path.relative(root, file)}`,
        );
    }
    for (const [, code] of (cells.Test ?? "").matchAll(CODE)) {
      if (!/\/.*\.\w+$/.test(code!)) continue;
      if (!fs.existsSync(path.join(root, "tests", code!)))
        out.push(`${id} (line ${line}): Test \`${code}\`: no tests/${code}`);
    }
  }
  return out;
}

/** Row ids a case title carries that the register doesn't have. */
export function unknownRowTags(doc: string, root = ROOT): string[] {
  const ids = new Set(registerRows(doc).map((r) => r.cells.Id));
  return answerKeyCases(root)
    .filter((c) => !ids.has(c.row))
    .map((c) => `tests/${c.file}: "${c.id}" tags [${c.row}], not a row`);
}

// ── CLI ─────────────────────────────────────────────────────────────────

async function main() {
  const file = path.join(ROOT, CALCULATIONS_DOC);
  const want = await generatedCalculationsDoc();
  const problems = [...missingPaths(want), ...unknownRowTags(want)];
  if (process.argv.includes("--update")) {
    if (fs.readFileSync(file, "utf8") !== want) {
      fs.writeFileSync(file, want);
      console.log(`Rewrote the Tested column in ${CALCULATIONS_DOC}.`);
    } else console.log(`${CALCULATIONS_DOC}: Tested column current.`);
  } else if (fs.readFileSync(file, "utf8") !== want) {
    problems.unshift(
      `${CALCULATIONS_DOC}: the Tested column is stale (an answer-key case was added, removed or retagged). Run 'pnpm docs:update' and commit the result.`,
    );
  }
  if (problems.length) {
    console.error(
      `FAIL: ${CALCULATIONS_DOC}\n  ${problems.join("\n  ")}\n` +
        "A moved function or test: fix its path in the row (don't drop the row).",
    );
    process.exit(1);
  }
  console.log(
    `PASS: ${CALCULATIONS_DOC} Tested column current; every Function and Test path exists.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
