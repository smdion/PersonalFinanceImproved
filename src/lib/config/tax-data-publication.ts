/** When each yearly tax table is due in a release, for CI and the "tax data is behind" notice. A due
 *  month from July on falls the year before the tax year, an earlier one in it (HHS's FPL). A year
 *  ships whole, so its IRS and CMS tables share the date its last notice (Pub 15-T) allows. */
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
    due: { month: 12, day: 31 },
  },
  {
    table: "tax_brackets",
    label: "Tax brackets",
    usually: "the IRS publishes them (Publication 15-T) in December",
    due: { month: 12, day: 31 },
  },
  {
    table: "ltcg_brackets",
    label: "Capital gains brackets",
    usually: "the IRS publishes them in October or November",
    due: { month: 12, day: 31 },
  },
  {
    table: "irmaa_brackets",
    label: "Medicare (IRMAA) brackets",
    usually: "Medicare publishes them in November",
    due: { month: 12, day: 31 },
  },
  {
    table: "fpl_by_household",
    label: "Poverty levels (ACA)",
    usually: "HHS publishes them in January",
    due: { month: 1, day: 31 },
  },
];
