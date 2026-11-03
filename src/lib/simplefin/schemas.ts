/** Every SimpleFIN response Ledgr reads, checked before use (protocol v1 and
 *  v2, https://www.simplefin.org/protocol.html). Only the fields Ledgr reads
 *  are required; money is a decimal string, times are Unix seconds. */
import { z } from "zod/v4";
import { zDecimal } from "@/lib/config/enum-values";

const unixSeconds = z.number().int();

/** A money field an institution may leave out or send as "": not sent. */
const sentDecimal = zDecimal.or(z.literal("")).optional();

/** Holdings aren't in the protocol's tables; these are the fields SimpleFIN
 *  Bridge sends. No symbol is a plan fund with no ticker. */
export const simplefinHoldingSchema = z.looseObject({
  symbol: z.string().optional(),
  description: z.string(),
  shares: zDecimal,
  market_value: sentDecimal,
  /** Per share; "0" when the institution sends none. */
  cost_basis: sentDecimal,
});

/** `posted` may be 0 while pending; the transaction's own date stands in,
 *  and a row with neither has no date to store. */
export const simplefinTransactionSchema = z
  .looseObject({
    id: z.string(),
    posted: unixSeconds,
    transacted_at: unixSeconds.optional(),
    amount: zDecimal,
    description: z.string(),
    /** Absent means posted. */
    pending: z.boolean().optional(),
  })
  .refine((t) => t.posted > 0 || (t.transacted_at ?? 0) > 0, {
    path: ["posted"],
    message: "0 (pending) with no transacted_at",
  });

/** One account's own fields, checked on their own: an account that doesn't
 *  fit is errored for this sync, not a failed sync. Its holdings and
 *  transactions are checked one by one after. */
export const simplefinAccountSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  balance: zDecimal,
  "balance-date": unixSeconds.optional(),
  /** v2: the account's connection, which names the institution. */
  conn_id: z.string().optional(),
  /** In the protocol's samples, not its tables. */
  conn_name: z.string().optional(),
  /** v1: the institution, on the account. */
  org: z.looseObject({ name: z.string().optional() }).optional(),
  /** Absent: no holdings reported (balances-only, or not supported). */
  holdings: z.array(z.unknown()).optional(),
  /** Absent on a balances-only request. */
  transactions: z.array(z.unknown()).optional(),
});

export const simplefinSchemas = {
  /** v1 sends only `errors`; v2 adds `errlist` and `connections`. */
  accounts: z
    .looseObject({
      errors: z.array(z.string()).optional(),
      errlist: z
        .array(
          z.looseObject({
            msg: z.string(),
            account_id: z.string().optional(),
            conn_id: z.string().optional(),
          }),
        )
        .optional(),
      connections: z
        .array(
          z.looseObject({
            conn_id: z.string(),
            name: z.string(),
            /** In the protocol's samples, not its tables. */
            org_name: z.string().optional(),
          }),
        )
        .optional(),
      /** Absent only on an answer whose errors say why. */
      accounts: z.array(z.unknown()).optional(),
    })
    .refine(
      (b) =>
        b.accounts !== undefined ||
        (b.errors?.length ?? 0) + (b.errlist?.length ?? 0) > 0,
      {
        path: ["accounts"],
        message: "expected array (or errors saying why not)",
      },
    ),
  /** The claim answers with the access URL as text; its credentials are the
   *  connection. */
  accessUrl: z.string().refine(
    (v) => {
      try {
        const url = new URL(v.trim());
        return url.protocol === "https:" && url.username !== "";
      } catch {
        return false;
      }
    },
    { message: "expected an https access URL with credentials" },
  ),
};

export type SimplefinRawAccount = z.infer<typeof simplefinAccountSchema>;
export type SimplefinAccountsBody = z.infer<typeof simplefinSchemas.accounts>;
