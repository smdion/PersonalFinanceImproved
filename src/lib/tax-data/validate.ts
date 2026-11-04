/**
 * The checks every tax-data file must pass — CI runs them on the shipped
 * file (tests/config/tax-data-file.test.ts) and the app runs them on a
 * community update before offering it, so a validly signed but wrong file
 * is still refused.
 */
import {
  TAX_DATA_FORMAT_VERSION,
  type TaxDataFile,
  type TaxDataYear,
} from "@/lib/db/reference-reconcile-core";
import { TAX_LIMIT_KEYS, taxLimitKey } from "@/lib/config/tax-limit-keys";
import { FILING_STATUS_ORDER } from "@/lib/config/filing-status";
import {
  fplByHouseholdAmountsSchema,
  irmaaBracketsSchema,
  ltcgBracketsSchema,
} from "@/lib/db/json-schemas";

/** Indexed dollar figures may move −2%…+15% a year. */
const INDEXED_BOUNDS = [0.98, 1.15] as const;
const within = (prev: number, next: number) =>
  prev === 0 ||
  (next / prev >= INDEXED_BOUNDS[0] && next / prev <= INDEXED_BOUNDS[1]);

type Row = Record<string, unknown>;
type Section = "withholding" | "ltcg" | "irmaa" | "fpl";
type Exception = { reason: string; source: string };

const rowsOf = (rows: unknown): Row[] =>
  Array.isArray(rows) ? (rows as Row[]) : [];
/** A row as text, key order ignored. */
const rowText = (r: Row) =>
  JSON.stringify(
    Object.keys(r ?? {})
      .sort()
      .map((k) => [k, r[k]]),
  );
const hasFigure = (rows: Row[], col?: string) =>
  rows.some((r) =>
    (col ? [r?.[col]] : Object.values(r ?? {})).some(
      (v) => typeof v === "number" && Number.isFinite(v),
    ),
  );
/** Every row identical, field for field (a blank table never matches). */
const sameRows = (was: unknown, now: unknown) => {
  const p = rowsOf(was);
  const n = rowsOf(now);
  return (
    n.length > 0 &&
    n.length === p.length &&
    hasFigure(n) &&
    n.every((r, i) => rowText(r) === rowText(p[i]!))
  );
};
/** One column identical in every row, the rest free to differ. */
const sameColumn = (was: unknown, now: unknown, col: string) => {
  const p = rowsOf(was);
  const n = rowsOf(now);
  return (
    n.length > 0 &&
    n.length === p.length &&
    hasFigure(n, col) &&
    n.every((r, i) => r?.[col] === p[i]?.[col])
  );
};

/** The tables of one section in `next` that repeat `prev`'s. */
function repeatsIn(
  prev: TaxDataYear,
  next: TaxDataYear,
  s: Section,
): { table: string; what: string }[] {
  const out: { table: string; what: string }[] = [];
  if (s === "fpl") {
    // Household sizes 1-8: the guidelines move every year.
    const was = prev.fpl?.amounts;
    const now = next.fpl?.amounts;
    const sizes = ["1", "2", "3", "4", "5", "6", "7", "8"];
    if (
      was &&
      now &&
      sizes.every((k) => Number.isFinite(now[k]) && now[k] === was[k])
    )
      out.push({ table: "amounts", what: "the same amounts" });
    return out;
  }
  if (s === "withholding") {
    for (const [st, t] of Object.entries(next.withholding?.tables ?? {}))
      for (const kind of ["standard", "checkbox"] as const)
        if (sameRows(prev.withholding?.tables[st]?.[kind], t?.[kind]))
          out.push({ table: `${st} ${kind}`, what: "the same table" });
    return out;
  }
  if (!prev[s] || !next[s]) return out;
  for (const [st, br] of Object.entries(next[s]!.brackets)) {
    const was = prev[s]!.brackets[st];
    if (sameRows(was, br)) out.push({ table: st, what: "the same table" });
    // Surcharges follow the Part B premium, which moves every year even
    // when the thresholds are frozen (2011-2017).
    else if (s === "irmaa" && sameColumn(was, br, "annualSurcharge"))
      out.push({ table: st, what: "the same surcharges" });
  }
  return out;
}

/**
 * Whether `next`'s exception (`pick` finds it: a section's, or one
 * limit's) excuses what a check found against `prev`. It counts when it's
 * the year's own (not the same as `prev`'s), or when it's carried over
 * from a `prev` that needed it against `older` too (`broke`: the same
 * check found something there), like a freeze lasting several years
 * (IRMAA's 2011-2017). An exception copied along with a whole file, from
 * a year that needed none, doesn't count. `older` is the shipped year
 * before `prev` (none: a carried exception never counts).
 */
function exceptionCounts(
  older: TaxDataYear | undefined,
  prev: TaxDataYear,
  next: TaxDataYear,
  pick: (d: TaxDataYear) => Exception | undefined,
  broke: (was: TaxDataYear, now: TaxDataYear) => boolean,
): boolean {
  const mine = pick(next);
  if (!mine) return false;
  const was = pick(prev);
  if (!was || rowText(mine) !== rowText(was)) return true;
  return !!older && broke(older, prev);
}

/**
 * The indexed tables in `next` that repeat the prior year's (`prev`), in
 * full: each withholding table (the 1040 brackets are derived from the
 * standard ones), each status's LTCG and IRMAA table, IRMAA's surcharges
 * on their own, and the poverty guidelines (`fpl`, sizes 1-8). An indexed
 * table moves every year, so a repeat was copied and not updated. Tables
 * only: a single `limits` value can legitimately repeat (the 401(k) limit
 * was $16,500 in 2009, 2010 and 2011). A blank table (no figures yet) is
 * left to the blank checks. The section's `exception` (reason and source)
 * ships a table that really repeats, when it counts (`exceptionCounts`).
 */
function copiedTables(
  older: TaxDataYear | undefined,
  prev: TaxDataYear,
  next: TaxDataYear,
): { section: Section; table: string; what: string }[] {
  const out: { section: Section; table: string; what: string }[] = [];
  for (const s of ["withholding", "ltcg", "irmaa", "fpl"] as const) {
    const repeats = repeatsIn(prev, next, s);
    if (
      repeats.length > 0 &&
      !exceptionCounts(
        older,
        prev,
        next,
        (d) => d[s]?.exception,
        (w, n) => repeatsIn(w, n, s).length > 0,
      )
    )
      out.push(...repeats.map((r) => ({ section: s, ...r })));
  }
  return out;
}

/** A limit's move from `was` to `now` its kind doesn't allow (indexed:
 *  outside the bounds; a rate or fixed amount: any move), as text. */
function limitBreak(
  k: string,
  was: number | undefined,
  now: number | undefined,
): string | undefined {
  const kind = taxLimitKey(k)?.kind;
  if (was === undefined || !kind) return undefined;
  const ok = kind === "indexed" ? within(was, now as number) : was === now;
  return ok ? undefined : `${was} → ${now} (${kind})`;
}

/** Thresholds in one bounds-checked section of `now` that moved outside
 *  the bounds from `was`, as text (each with its table and row). */
function sectionBreaks(
  was: TaxDataYear,
  now: TaxDataYear,
  s: "withholding" | "ltcg" | "irmaa",
): string[] {
  const out: string[] = [];
  type T = { threshold?: number | null; magiThreshold?: number };
  const check = (label: string, p: T[], n: T[]) =>
    n.forEach((r, i) => {
      const a = p[i]?.threshold ?? p[i]?.magiThreshold;
      const b = r.threshold ?? r.magiThreshold;
      if (a && b && !within(a, b)) out.push(`${label} row ${i}: ${a} → ${b}`);
    });
  if (s === "withholding") {
    for (const [st, t] of Object.entries(now.withholding?.tables ?? {}))
      for (const kind of ["standard", "checkbox"] as const)
        check(
          `withholding ${st} ${kind}`,
          (was.withholding?.tables[st]?.[kind] ?? []) as T[],
          (t?.[kind] ?? []) as T[],
        );
    return out;
  }
  if (!was[s] || !now[s]) return out;
  for (const [st, br] of Object.entries(now[s]!.brackets))
    check(`${s} ${st}`, (was[s]!.brackets[st] ?? []) as T[], br as T[]);
  return out;
}

/** The citations in a `source` string ("A; B" → ["A", "B"]). */
export function citationsOf(source: string | undefined): string[] {
  return (source ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Every `source` in a year — the year's, each figure's, each section's
 *  and each exception's — with where it is, for messages. */
function yearSources(d: TaxDataYear): { at: string; source: string }[] {
  const out = [{ at: "", source: d.source }];
  for (const [k, l] of Object.entries(d.limits)) {
    out.push({ at: ` ${k}`, source: l.source });
    if (l.exception)
      out.push({ at: ` ${k} exception`, source: l.exception.source });
  }
  for (const s of ["withholding", "ltcg", "irmaa", "fpl"] as const) {
    const sec = d[s];
    if (!sec) continue;
    out.push({ at: ` ${s}`, source: sec.source });
    if (sec.exception)
      out.push({ at: ` ${s} exception`, source: sec.exception.source });
  }
  return out;
}

/** Limit keys this Ledgr doesn't know, by year. */
export function unknownTaxDataKeys(file: TaxDataFile): string[] {
  return Object.entries(file.years).flatMap(([y, d]) =>
    Object.keys(d.limits)
      .filter((k) => !taxLimitKey(k))
      .map((k) => `${y} ${k}`),
  );
}

/** Every problem with the file, as readable lines (empty = valid).
 *  Unknown keys are a problem only when `unknownKeys` is "reject" (CI on
 *  the shipped file); a community update may carry keys a newer Ledgr
 *  uses. */
export function validateTaxDataFile(
  file: TaxDataFile,
  {
    unknownKeys = "reject",
    citations = "strict",
  }: {
    unknownKeys?: "reject" | "ignore";
    /** "strict" (CI, publish, tax-data:check): every citation links to its
     *  document. An install checking a community update passes "lenient" —
     *  a citation typo must not refuse a correct figure. */
    citations?: "strict" | "lenient";
  } = {},
): string[] {
  const problems: string[] = [];
  const add = (p: string) => problems.push(p);

  if (file.formatVersion !== TAX_DATA_FORMAT_VERSION)
    add(
      `format ${file.formatVersion} (this Ledgr reads ${TAX_DATA_FORMAT_VERSION})`,
    );
  if (!Number.isInteger(file.dataVersion) || file.dataVersion <= 0)
    add(`dataVersion ${file.dataVersion} is not a positive integer`);
  const years = Object.keys(file.years ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) {
    add("no years");
    return problems;
  }
  const pairs = years.slice(1).map((y, i) => [years[i]!, y] as const);

  if (unknownKeys === "reject")
    for (const k of unknownTaxDataKeys(file)) add(`unknown key ${k}`);

  const latest = file.years[years[years.length - 1]!]!.limits;
  for (const k of TAX_LIMIT_KEYS)
    if (!(k.key in latest)) add(`latest year is missing ${k.key}`);

  for (const y of years) {
    const d = file.years[y]!;
    if (!d.source?.trim()) add(`${y}: no source`);
    // Every citation links to its document: the year's `sources` map.
    if (citations === "strict") {
      const links = d.sources ?? {};
      if (!d.sources) add(`${y}: no sources map (citation → link)`);
      const cited = new Set<string>();
      for (const { at, source } of yearSources(d))
        for (const c of citationsOf(source)) {
          cited.add(c);
          if (!/^https:\/\/\S+$/.test(links[c] ?? ""))
            add(`${y}${at}: "${c}" has no https link in sources`);
        }
      for (const c of Object.keys(links))
        if (!cited.has(c)) add(`${y} sources: "${c}" isn't cited`);
    }
    for (const [k, l] of Object.entries(d.limits)) {
      if (!l.source?.trim()) add(`${y} ${k}: no source`);
      if (typeof l.value !== "number" || !Number.isFinite(l.value))
        add(`${y} ${k}: not a number`);
    }
    for (const s of ["withholding", "ltcg", "irmaa", "fpl"] as const) {
      const sec = d[s];
      if (sec && !sec.source?.trim()) add(`${y} ${s}: no source`);
      if (sec?.exception && !(sec.exception.reason && sec.exception.source))
        add(`${y} ${s}: exception without reason and source`);
    }
    const statuses = [...FILING_STATUS_ORDER].sort().join(",");
    if (
      Object.keys(d.withholding?.tables ?? {})
        .sort()
        .join(",") !== statuses
    )
      add(`${y} withholding: filing statuses must be ${statuses}`);
    for (const s of ["ltcg", "irmaa"] as const)
      if (d[s] && Object.keys(d[s]!.brackets).sort().join(",") !== statuses)
        add(`${y} ${s}: filing statuses must be ${statuses}`);
    for (const [st, b] of Object.entries(d.ltcg?.brackets ?? {}))
      if (!ltcgBracketsSchema.safeParse(b).success)
        add(`${y} ltcg ${st}: brackets out of shape`);
    for (const [st, b] of Object.entries(d.irmaa?.brackets ?? {}))
      if (!irmaaBracketsSchema.safeParse(b).success)
        add(`${y} irmaa ${st}: brackets out of shape`);
    if (d.fpl && !fplByHouseholdAmountsSchema.safeParse(d.fpl.amounts).success)
      add(`${y} fpl: needs sizes 1–8`);
    if (!Number.isInteger(d.revision) || d.revision < 1)
      add(`${y}: revision must be a whole number from 1`);
    for (const [st, t] of Object.entries(d.withholding?.tables ?? {}))
      for (const kind of ["standard", "checkbox"] as const) {
        const rows = (t[kind] ?? []) as {
          threshold: number;
          baseWithholding: number;
          rate: number;
        }[];
        // A blank (a new year not filled in yet) never passes.
        rows.forEach((r, i) => {
          for (const f of ["threshold", "baseWithholding", "rate"] as const)
            if (typeof r[f] !== "number" || !Number.isFinite(r[f]))
              add(`${y} withholding ${st} ${kind} row ${i}: ${f} is blank`);
        });
        rows.slice(1).forEach((r, i) => {
          const p = rows[i]!;
          const expected =
            p.baseWithholding + p.rate * (r.threshold - p.threshold);
          if (Math.abs(r.baseWithholding - expected) > 1)
            add(
              `${y} withholding ${st} ${kind} @${r.threshold}: base ${r.baseWithholding}, expected ${expected.toFixed(2)}`,
            );
        });
      }
  }

  for (const [prev, next] of pairs) {
    const a = file.years[prev]!;
    const b = file.years[next]!;
    const before = a.limits;
    const after = b.limits;
    const olderYear = pairs.find(([, n]) => n === prev)?.[0];
    const older = olderYear === undefined ? undefined : file.years[olderYear];
    const sunset = before.obbba_senior_deduction_sunset_year?.value;
    for (const k of Object.keys(before))
      if (
        !(k in after) &&
        !(k.startsWith("obbba_") && sunset !== undefined && next > sunset)
      )
        add(`${next}: dropped ${k}`);
    // An exception lets a figure move outside its bounds when it counts
    // (`exceptionCounts`): a limit's own, per limit; a section's for its
    // tables.
    for (const [k, l] of Object.entries(after)) {
      const broke = limitBreak(k, before[k]?.value, l.value);
      if (
        broke &&
        !exceptionCounts(
          older,
          a,
          b,
          (d) => d.limits[k]?.exception,
          (w, n) => !!limitBreak(k, w.limits[k]?.value, n.limits[k]?.value),
        )
      )
        add(`${next} ${k}: ${broke}`);
    }
    for (const s of ["withholding", "ltcg", "irmaa"] as const) {
      const broke = sectionBreaks(a, b, s);
      if (
        broke.length > 0 &&
        !exceptionCounts(
          older,
          a,
          b,
          (d) => d[s]?.exception,
          (w, n) => sectionBreaks(w, n, s).length > 0,
        )
      )
        for (const p of broke) add(`${next} ${p}`);
    }
    for (const { section, table, what } of copiedTables(older, a, b))
      add(
        `${next} ${section} ${table}: ${what} as ${prev}'s. Indexed tables change every year, so this one looks copied and not updated: key it from the ${next} publication. If the publication really repeats it, give ${next} ${section} an exception (reason and source).`,
      );
  }
  return problems;
}
