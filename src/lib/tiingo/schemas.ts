/** Every Tiingo end-of-day response Ledgr reads, checked before use: only
 *  the fields Ledgr reads are required, anything else passes. Prices are
 *  finite numbers; a price row's date is an ISO timestamp. */
import { z } from "zod/v4";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

/** `/tiingo/daily/:ticker`: a ticker with no price data has null dates. */
export const tickerMetaSchema = z.looseObject({
  ticker: z.string(),
  startDate: day.nullable(),
});

/** `/prices?resampleFreq=monthly`: month-end total-return closes. */
export const monthlyPricesSchema = z.array(
  z.looseObject({ date: day, adjClose: z.number() }),
);

/** `/prices?startDate=`: every daily row carries its distribution (0 when
 *  none) and split factor (1 when none). */
export const dailyClosesSchema = z.array(
  z.looseObject({
    date: day,
    close: z.number(),
    divCash: z.number(),
    splitFactor: z.number(),
  }),
);

/** `/prices`: the latest close. */
export const latestCloseSchema = z.array(
  z.looseObject({ date: day, close: z.number() }),
);
