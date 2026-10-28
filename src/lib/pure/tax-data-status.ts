/**
 * Is the household's tax data current? For the "tax data is behind" notice
 * (Settings → Reference Data, the sidebar's Data indicator) and the CI
 * check (scripts/check-tax-params.ts) — one rule, set by each table's
 * usual publication date (lib/config/tax-data-publication.ts), so the
 * notice says "expected about November" instead of nagging in March.
 */
import {
  TAX_DATA_SECTIONS,
  type TaxDataSection,
} from "@/lib/config/tax-data-publication";

/** The date a table's figures for `taxYear` are due. */
export function taxYearDeadline(
  taxYear: number,
  due: TaxDataSection["due"],
): Date {
  const calendarYear = due.month >= 7 ? taxYear - 1 : taxYear;
  return new Date(calendarYear, due.month - 1, due.day, 23, 59, 59);
}

/** The newest tax year a table should already have, as of `now`. */
export function expectedTaxYear(due: TaxDataSection["due"], now: Date): number {
  const next = now.getFullYear() + 1;
  return now > taxYearDeadline(next, due) ? next : next - 1;
}

type TaxDataSectionStatus = TaxDataSection & {
  /** The year it should have by now. */
  expectedYear: number;
  /** The newest year it has (null = none at all). */
  newestYear: number | null;
  /** Past due and missing — projections use `newestYear`'s figures. */
  behind: boolean;
  /** The next year, not due yet and not in yet (and its due date). */
  upcoming: { year: number; due: Date } | null;
};

export type CarriedFigure = {
  table: TaxDataSection["table"];
  taxYear: number;
  /** What it is (a limit key, or a filing status for a table). */
  name: string;
};

type TaxDataStatus = {
  sections: TaxDataSectionStatus[];
  /** Copied forward from an earlier year and not yet confirmed or edited. */
  carried: CarriedFigure[];
  needsAttention: boolean;
  /** One line for the Data indicator; null when current. */
  summary: string | null;
};

export function taxDataStatus(
  input: {
    yearsByTable: Partial<Record<TaxDataSection["table"], readonly number[]>>;
    carried?: readonly CarriedFigure[];
  },
  now: Date = new Date(),
): TaxDataStatus {
  const sections = TAX_DATA_SECTIONS.map((s) => {
    const years = input.yearsByTable[s.table] ?? [];
    const newestYear = years.length ? Math.max(...years) : null;
    const expectedYear = expectedTaxYear(s.due, now);
    const next = expectedYear + 1;
    return {
      ...s,
      expectedYear,
      newestYear,
      behind: !years.includes(expectedYear),
      upcoming: years.includes(next)
        ? null
        : { year: next, due: taxYearDeadline(next, s.due) },
    };
  });
  const behind = sections.filter((s) => s.behind);
  const carried = [...(input.carried ?? [])];
  const parts = [
    behind.length > 0 &&
      `${behind[0]!.expectedYear} ${behind.length === 1 ? behind[0]!.label.toLowerCase() : "tax data"} not in yet`,
    carried.length > 0 &&
      `${carried.length} carried-forward figure${carried.length === 1 ? "" : "s"} to confirm`,
  ].filter((p): p is string => typeof p === "string");
  return {
    sections,
    carried,
    needsAttention: parts.length > 0,
    summary: parts.length ? parts.join("; ") : null,
  };
}
