/**
 * The JSON ratchets: size-baseline.json, the ESLint suppressions files, the
 * calculation-register baseline, the duplicate-code counts and the count of
 * procedures without a doc comment, each compared with its base copy.
 */
import { members, sumByGroup } from "./moves";
import { named, type Rise } from "./rise";

export const SIZE_FILE = "size-baseline.json";
/** The axe baseline's keys are pages (`e2e-b/budget`), not paths. */
export const AXE_FILE = "tests/accessibility/axe-baseline.json";
export const SUPPRESSION_FILES = [
  "eslint-suppressions.json",
  "eslint-suppressions-typed.json",
  AXE_FILE,
];
export const REGISTER_FILE = "scripts/calculation-register-baseline.json";
/** scripts/check-duplicates.ts's totals: jscpd's copied blocks and lines. */
export const DUPLICATES_FILE = "scripts/ratchets/duplicates.json";
/** tests/lint/procedure-doc-comments.test.ts's count. */
export const UNDOCUMENTED_FILE =
  "scripts/ratchets/undocumented-procedures.json";
const FILE_LIMIT = 400;

export type SizeBaseline = {
  files: Record<string, number>;
  functions: Record<string, Record<string, number>>;
};

/**
 * No recorded file or function rises. A split part at or under FILE_LIMIT is
 * free (that is the limit for an unrecorded file); parts over it, with what
 * is left of the old file, never total more than the old entries.
 */
export function sizeRises(
  base: SizeBaseline,
  head: SizeBaseline,
  group: (file: string) => string,
): Rise[] {
  const rises: Rise[] = [];
  const counted = (file: string, lines: number) =>
    file in base.files || lines > FILE_LIMIT ? lines : 0;
  const baseFiles = sumByGroup(base.files, group, (_, n) => n);
  const headFiles = sumByGroup(head.files, group, counted);
  for (const [g, sum] of headFiles) {
    const was = baseFiles.get(g) ?? 0;
    if (sum <= was) continue;
    const files = members(Object.keys(head.files), group, g).filter(
      (f) => counted(f, head.files[f]!) > 0,
    );
    const sized = [
      ...new Set([...members(Object.keys(base.files), group, g), ...files]),
    ].sort();
    rises.push({
      file: SIZE_FILE,
      id: `${SIZE_FILE}\0files ${files.join(", ")}`,
      text: `files ${files.join(", ")}: ${sum} recorded lines, ${was} at the base`,
      by: sum - was,
      entry: { paths: sized, names: [] },
      sized,
    });
  }
  const fnSum = (fns: Record<string, number>) =>
    Object.values(fns).reduce((a, b) => a + b, 0);
  const fnMax = (fns: Record<string, number>) =>
    Math.max(0, ...Object.values(fns));
  const baseFns = sumByGroup(base.functions, group, (_, fns) => fnSum(fns));
  const headFns = sumByGroup(head.functions, group, (_, fns) => fnSum(fns));
  const maxOf = (side: SizeBaseline, g: string) =>
    Math.max(
      0,
      ...members(Object.keys(side.functions), group, g).map((f) =>
        fnMax(side.functions[f]!),
      ),
    );
  for (const [g, sum] of headFns) {
    const was = baseFns.get(g) ?? 0;
    const longest = maxOf(head, g);
    const wasLongest = maxOf(base, g);
    if (sum <= was && longest <= wasLongest) continue;
    const files = members(Object.keys(head.functions), group, g).filter(
      (f) => Object.keys(head.functions[f]!).length > 0,
    );
    const wasFn = new Map<string, number>();
    for (const f of members(Object.keys(base.functions), group, g))
      for (const [fn, n] of Object.entries(base.functions[f]!))
        wasFn.set(fn, Math.max(n, wasFn.get(fn) ?? 0));
    const grew = files.flatMap((f) =>
      Object.entries(head.functions[f]!)
        .filter(([fn, n]) => n > (wasFn.get(fn) ?? 0))
        .map(([fn]) => fn),
    );
    rises.push({
      file: SIZE_FILE,
      id: `${SIZE_FILE}\0functions in ${files.join(", ")}`,
      text: `functions in ${files.join(", ")}: ${sum} recorded lines (longest ${longest}), ${was} (longest ${wasLongest}) at the base`,
      by: Math.max(sum - was, longest - wasLongest),
      entry: { paths: files, names: grew.length > 0 ? [grew] : [] },
    });
  }
  return rises;
}

export type Suppressions = Record<string, Record<string, { count: number }>>;

/**
 * No rule's count rises in a file, or across the files of a move or split.
 * The axe baseline's pages are named in a trailer as words, with the rule.
 */
export function suppressionRises(
  file: string,
  base: Suppressions,
  head: Suppressions,
  group: (file: string) => string,
): Rise[] {
  const totals = (side: Suppressions) => {
    const sums = new Map<string, number>();
    for (const [f, rules] of Object.entries(side))
      for (const [rule, { count }] of Object.entries(rules)) {
        const key = `${group(f)}\0${rule}`;
        sums.set(key, (sums.get(key) ?? 0) + count);
      }
    return sums;
  };
  const was = totals(base);
  const rises: Rise[] = [];
  for (const [key, count] of totals(head)) {
    const before = was.get(key) ?? 0;
    if (count <= before) continue;
    const [g, rule] = key.split("\0") as [string, string];
    const files = members(Object.keys(head), group, g).filter(
      (f) => head[f]![rule],
    );
    const keys = members(Object.keys(base), group, g).concat(files);
    rises.push({
      file,
      id: `${file}\0${rule} in ${files.join(", ")}`,
      text: `${rule} in ${files.join(", ")}: ${count}, ${before} at the base`,
      by: count - before,
      entry:
        file === AXE_FILE
          ? { paths: [], names: [[...new Set(keys)], [rule]] }
          : { paths: keys, names: [[rule]] },
    });
  }
  return rises;
}

export type Register = {
  risk: Record<string, string>;
  highRiskWithoutIndependentTest: string[];
  exportsWithoutRow: string[];
};
const RISK_ORDER: Record<string, number> = { H: 3, M: 2, L: 1 };

/**
 * The register's lists only shrink and no row's risk is lowered. An export
 * that moved keeps its entry: a new `file:symbol` is matched by a removed
 * entry for the same symbol.
 */
/** `src/a/b.ts:sym` → `b.ts`: a register trailer names the file and the export. */
const basename = (e: string) => {
  const file = e.slice(0, e.lastIndexOf(":"));
  return file.slice(file.lastIndexOf("/") + 1);
};

export function registerRises(base: Register, head: Register): Rise[] {
  const rises: Rise[] = [];
  for (const [id, risk] of Object.entries(head.risk)) {
    const before = base.risk[id];
    if (before && (RISK_ORDER[risk] ?? 0) < (RISK_ORDER[before] ?? 0))
      rises.push(
        named(REGISTER_FILE, `risk ${id}`, `${id}: risk ${before} → ${risk}`, [
          id,
        ]),
      );
  }
  const wasHigh = new Set(base.highRiskWithoutIndependentTest);
  for (const id of head.highRiskWithoutIndependentTest)
    if (!wasHigh.has(id))
      rises.push(
        named(
          REGISTER_FILE,
          `high ${id}`,
          `${id}: added to highRiskWithoutIndependentTest`,
          [id],
        ),
      );
  const now = new Set(head.exportsWithoutRow);
  const symbol = (e: string) => e.slice(e.lastIndexOf(":") + 1);
  const freed = new Map<string, number>();
  for (const e of base.exportsWithoutRow)
    if (!now.has(e)) freed.set(symbol(e), (freed.get(symbol(e)) ?? 0) + 1);
  const was = new Set(base.exportsWithoutRow);
  for (const e of head.exportsWithoutRow) {
    if (was.has(e)) continue;
    const left = freed.get(symbol(e)) ?? 0;
    if (left > 0) freed.set(symbol(e), left - 1);
    else
      rises.push({
        ...named(REGISTER_FILE, e, `${e}: added to exportsWithoutRow`, [
          symbol(e),
        ]),
        entry: { paths: [], names: [[basename(e)], [symbol(e)]] },
      });
  }
  return rises;
}

export type Duplicates = { blocks: number; lines: number };

/** Neither total rises; a file the base doesn't have yet starts the count. */
export function duplicateRises(
  base: Duplicates | undefined,
  head: Duplicates | undefined,
): Rise[] {
  if (!base || !head) return [];
  return (["blocks", "lines"] as const)
    .filter((key) => head[key] > base[key])
    .map((key) =>
      named(
        DUPLICATES_FILE,
        key,
        `copied ${key}: ${head[key]}, ${base[key]} at the base`,
        [key],
        head[key] - base[key],
      ),
    );
}

export type Undocumented = { procedures: number };

/** The count doesn't rise; a file the base doesn't have yet starts it. */
export function undocumentedRises(
  base: Undocumented | undefined,
  head: Undocumented | undefined,
): Rise[] {
  if (!base || !head || head.procedures <= base.procedures) return [];
  return [
    named(
      UNDOCUMENTED_FILE,
      "procedures",
      `procedures without a doc comment: ${head.procedures}, ${base.procedures} at the base`,
      ["procedures"],
      head.procedures - base.procedures,
    ),
  ];
}
