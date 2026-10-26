/**
 * The checks every tax-data file must pass — CI runs them on the shipped
 * file (tests/config/tax-data-file.test.ts) and the app runs them on a
 * community update before offering it, so a validly signed but wrong file
 * is still refused.
 */
import {
  TAX_DATA_FORMAT_VERSION,
  type TaxDataFile,
} from "@/lib/db/reference-reconcile-core";
import { TAX_LIMIT_KEYS, taxLimitKey } from "@/lib/config/tax-limit-keys";
import { REQUIRED_FILING_STATUSES } from "@/lib/config/tax-params";
import {
  fplByHouseholdAmountsSchema,
  irmaaBracketsSchema,
  ltcgBracketsSchema,
} from "@/lib/db/json-schemas";

/** Indexed dollar figures may move −2%…+15% a year. */
export const INDEXED_BOUNDS = [0.98, 1.15] as const;
const within = (prev: number, next: number) =>
  prev === 0 ||
  (next / prev >= INDEXED_BOUNDS[0] && next / prev <= INDEXED_BOUNDS[1]);

/** Limit keys this Ledgr doesn't know, by year. */
export function unknownTaxDataKeys(file: TaxDataFile): string[] {
  return Object.entries(file.years).flatMap(([y, d]) =>
    Object.keys(d.limits)
      .filter((k) => !taxLimitKey(k))
      .map((k) => `${y} ${k}`),
  );
}

/** The file without limit keys this Ledgr doesn't know (a newer file may
 *  ship figures for features an older install doesn't have). */
export function withKnownKeysOnly(file: TaxDataFile): TaxDataFile {
  return {
    ...file,
    years: Object.fromEntries(
      Object.entries(file.years).map(([y, d]) => [
        y,
        {
          ...d,
          limits: Object.fromEntries(
            Object.entries(d.limits).filter(([k]) => taxLimitKey(k)),
          ),
        },
      ]),
    ),
  };
}

/** Every problem with the file, as readable lines (empty = valid).
 *  Unknown keys are a problem only when `unknownKeys` is "reject" (CI on
 *  the shipped file); the app drops them first. */
export function validateTaxDataFile(
  file: TaxDataFile,
  { unknownKeys = "reject" }: { unknownKeys?: "reject" | "ignore" } = {},
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
    const statuses = [...REQUIRED_FILING_STATUSES].sort().join(",");
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
    for (const [st, t] of Object.entries(d.withholding?.tables ?? {}))
      for (const kind of ["standard", "checkbox"] as const) {
        const rows = (t[kind] ?? []) as {
          threshold: number;
          baseWithholding: number;
          rate: number;
        }[];
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
    const before = file.years[prev]!.limits;
    const after = file.years[next]!.limits;
    const sunset = before.obbba_senior_deduction_sunset_year?.value;
    for (const k of Object.keys(before))
      if (
        !(k in after) &&
        !(k.startsWith("obbba_") && sunset !== undefined && next > sunset)
      )
        add(`${next}: dropped ${k}`);
    for (const [k, l] of Object.entries(after)) {
      const was = before[k]?.value;
      const kind = taxLimitKey(k)?.kind;
      if (was === undefined || !kind || l.exception) continue;
      const ok = kind === "indexed" ? within(was, l.value) : was === l.value;
      if (!ok) add(`${next} ${k}: ${was} → ${l.value} (${kind})`);
    }
    const a = file.years[prev]!;
    const b = file.years[next]!;
    const check = (
      label: string,
      was: { threshold?: number | null }[],
      now: { threshold?: number | null }[],
    ) =>
      now.forEach((r, i) => {
        const p = was[i]?.threshold;
        if (p && r.threshold && !within(p, r.threshold))
          add(`${label} row ${i}: ${p} → ${r.threshold}`);
      });
    if (!b.withholding.exception)
      for (const [st, t] of Object.entries(b.withholding.tables))
        for (const kind of ["standard", "checkbox"] as const)
          check(
            `${next} withholding ${st} ${kind}`,
            (a.withholding.tables[st]?.[kind] ?? []) as { threshold: number }[],
            t[kind] as { threshold: number }[],
          );
    for (const s of ["ltcg", "irmaa"] as const)
      if (a[s] && b[s] && !b[s]!.exception)
        for (const [st, br] of Object.entries(b[s]!.brackets)) {
          const norm = (rows: unknown[]) =>
            (
              rows as { magiThreshold?: number; threshold?: number | null }[]
            ).map((r) => ({ threshold: r.threshold ?? r.magiThreshold }));
          check(`${next} ${s} ${st}`, norm(a[s]!.brackets[st] ?? []), norm(br));
        }
  }
  return problems;
}
