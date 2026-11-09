/** When each yearly tax table is published and by when a release must carry it, for CI and the
 *  "tax data is behind" notice. A `due` month from July on falls in the year before the tax
 *  year (IRS/CMS publish ahead); an earlier month in the tax year itself (HHS's FPL). */
import type { ReferenceTable } from "@/lib/db/migrate/reference-data";

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
