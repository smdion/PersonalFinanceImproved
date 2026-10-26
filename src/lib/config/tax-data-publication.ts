/**
 * When each yearly tax table is published, and by when a release should
 * carry it. One list for the CI check (scripts/check-tax-params.ts) and the
 * app's "tax data is behind" notice (lib/pure/tax-data-status.ts).
 *
 * `due` is after the usual release window, so a late year never fails CI
 * before the source exists. A month from July on falls in the year BEFORE
 * the tax year (IRS / CMS publish ahead); an earlier month falls in the
 * tax year itself (HHS publishes the poverty guidelines in January — FPL
 * rows are keyed by the ACA coverage year, which uses the guidelines
 * published the prior calendar year).
 */
import type { ReferenceTable } from "@/lib/db/reference-data";

export type TaxDataSection = {
  table: Exclude<ReferenceTable, "tax_params">;
  /** Plain-words name, as Settings → Reference Data shows it. */
  label: string;
  /** Who publishes it and when, in words. */
  usually: string;
  due: { month: number; day: number };
};

export const TAX_DATA_SECTIONS: readonly TaxDataSection[] = [
  {
    table: "contribution_limits",
    label: "IRS limits",
    usually: "the IRS publishes them in October or November",
    due: { month: 11, day: 30 },
  },
  {
    table: "tax_brackets",
    label: "Tax brackets",
    usually: "the IRS publishes them in October or November",
    due: { month: 11, day: 30 },
  },
  {
    table: "ltcg_brackets",
    label: "Capital gains brackets",
    usually: "the IRS publishes them in October or November",
    due: { month: 11, day: 30 },
  },
  {
    table: "irmaa_brackets",
    label: "Medicare (IRMAA) brackets",
    usually: "Medicare publishes them in October or November",
    due: { month: 11, day: 30 },
  },
  {
    table: "fpl_by_household",
    label: "Poverty levels (ACA)",
    usually: "HHS publishes them in January",
    due: { month: 1, day: 31 },
  },
];
