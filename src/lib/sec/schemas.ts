/** Everything Ledgr reads from SEC, checked before use: the two JSON files
 *  as served, the CSV and XML data as the parsers return it. A field the
 *  parser didn't find is undefined, so a renamed one fails here. */
import { z } from "zod/v4";

/** `company_tickers_mf.json`: rows of values in `fields` order, checked as
 *  objects so a renamed field is named. A class with no symbol is skipped. */
export const fundTickersSchema = z
  .looseObject({
    fields: z.array(z.string()),
    data: z.array(z.array(z.unknown())),
  })
  .transform(({ fields, data }) =>
    data.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]]))),
  )
  .pipe(
    z.array(
      z.looseObject({
        symbol: z.string().nullable(),
        seriesId: z.string(),
        classId: z.string(),
      }),
    ),
  );

/** A filing folder's `index.json`. */
export const filingIndexSchema = z.looseObject({
  directory: z.looseObject({
    item: z.array(z.looseObject({ name: z.string() })),
  }),
});

/** The fund series/class registry CSV; it always lists funds. */
export const registrySchema = z
  .array(
    z.object({
      cik: z.string(),
      seriesId: z.string(),
      seriesName: z.string(),
      classId: z.string(),
      ticker: z.string().nullable(),
    }),
  )
  .min(1);
export type RegistryClass = z.infer<typeof registrySchema>[number];

/** An EDGAR filing list; a fund with no filings of a type has none. */
export const filingsSchema = z.array(
  z.object({
    accession: z.string().min(1),
    filingHref: z.url(),
    filingDate: z.iso.date(),
  }),
);
export type EdgarFiling = z.infer<typeof filingsSchema>[number];

/** An N-PORT: its period date and holdings (none in liquidation or all
 *  cash). A series or holding without an LEI, or a category, has null. */
export const nportSchema = z.object({
  seriesLei: z.string().nullable(),
  periodDate: z.iso.date(),
  holdings: z.array(
    z.object({
      name: z.string(),
      lei: z.string().nullable(),
      pctVal: z.number(),
      assetCat: z.string().nullable(),
      invCountry: z.string().nullable(),
      payoffProfile: z.string().nullable(),
      issuerCat: z.string().nullable(),
    }),
  ),
});

/** Share class id → expense ratio, from a shareholder report. A report
 *  without one is an empty map. */
export const expenseRatiosSchema = z.map(z.string(), z.number());
