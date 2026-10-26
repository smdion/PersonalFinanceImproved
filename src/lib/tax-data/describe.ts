/**
 * A community update's changes in words for the review table: which
 * section, year and figure, current and new value, and the citation the
 * file gives for it.
 */
import type { RefChange, TaxDataFile } from "@/lib/db/reference-reconcile-core";
import { taxLimitKey } from "@/lib/config/tax-limit-keys";
import { TAX_DATA_SECTIONS } from "@/lib/config/tax-data-publication";

export type TaxDataChangeRow = {
  section: string;
  year: number;
  figure: string;
  /** Numbers for an IRS limit (format says how to show them); a table's
   *  current/new value is described, not listed. */
  format: "currency" | "percent" | "year" | "table";
  from: number | null;
  to: number | null;
  kind: "insert" | "update";
  source: string;
};

const STATUS: Record<string, string> = {
  MFJ: "married filing jointly",
  Single: "single",
  HOH: "head of household",
};

const num = (v: unknown) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

export function describeTaxDataChanges(
  changes: RefChange[],
  file: TaxDataFile,
): TaxDataChangeRow[] {
  const sectionLabel = (table: string) =>
    TAX_DATA_SECTIONS.find((s) => s.table === table)?.label ?? table;
  return changes.map((c) => {
    const parts = c.key.split("|");
    const year = Number(parts[0]);
    const y = file.years[String(year)];
    const base = { section: sectionLabel(c.table), year, kind: c.kind };
    if (c.table === "contribution_limits") {
      const k = taxLimitKey(parts[1]!);
      const l = y?.limits[parts[1]!];
      return {
        ...base,
        figure: k ? `${k.group} — ${k.label}` : parts[1]!,
        format: k?.format ?? "currency",
        from: num(c.from),
        to: num(c.to),
        source: l?.source ?? y?.source ?? "",
      };
    }
    const status = STATUS[parts[1] ?? ""] ?? parts[1] ?? "";
    const figure =
      c.table === "tax_brackets"
        ? `Withholding, ${status}${parts[2] === "1" ? " (Step 2 checkbox)" : ""}`
        : c.table === "fpl_by_household"
          ? "Poverty levels by household size"
          : `Brackets, ${status}`;
    const source =
      c.table === "tax_brackets"
        ? y?.withholding.source
        : c.table === "ltcg_brackets"
          ? y?.ltcg?.source
          : c.table === "irmaa_brackets"
            ? y?.irmaa?.source
            : y?.fpl?.source;
    return {
      ...base,
      figure,
      format: "table",
      from: null,
      to: null,
      source: source ?? y?.source ?? "",
    };
  });
}
