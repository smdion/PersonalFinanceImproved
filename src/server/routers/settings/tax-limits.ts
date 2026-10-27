import { z } from "zod/v4";
import { eq, asc, max } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/server/helpers";
import { zDecimal } from "./_shared";
import {
  taxBracketsSchema,
  ltcgBracketsSchema,
  irmaaBracketsSchema,
  fplByHouseholdAmountsSchema,
} from "@/lib/db/json-schemas";
import {
  sameReferenceValue,
  shippedReferenceRows,
} from "@/lib/db/reference-reconcile-core";
import {
  approvedCommunityFile,
  readTaxDataFile,
  reconcileReferenceData,
} from "@/lib/db/reference-data";
import { taxLimitKey } from "@/lib/config/tax-limit-keys";
import { citationsOf } from "@/lib/tax-data/validate";
import { taxDataStatus, type CarriedFigure } from "@/lib/pure/tax-data-status";
import { pendingUpdate } from "./tax-data-sync";
import { localDateStr } from "@/lib/utils/date";

// --- Where a figure came from (lib/db/reference-reconcile-core.ts) ---

type RefTable = (typeof SHIPPED_KEY)[keyof typeof SHIPPED_KEY];
/** Each table's natural key and value column, as the reconcile sees them. */
const SHIPPED_KEY = {
  contribution_limits: {
    cols: ["taxYear", "limitType"],
    value: "value",
    json: false,
  },
  tax_brackets: {
    cols: ["taxYear", "filingStatus", "w4Checkbox"],
    value: "brackets",
    json: true,
  },
  ltcg_brackets: {
    cols: ["taxYear", "filingStatus"],
    value: "brackets",
    json: true,
  },
  irmaa_brackets: {
    cols: ["taxYear", "filingStatus"],
    value: "brackets",
    json: true,
  },
  fpl_by_household: { cols: ["taxYear"], value: "amounts", json: true },
} as const;

const keyText = (vals: unknown[]) =>
  vals
    .map((v) => (typeof v === "boolean" ? (v ? "1" : "0") : String(v)))
    .join("|");

/** What Ledgr ships here: every row of the shipped file and of a newer
 *  approved community update (both are applied, so neither's rows may be
 *  deleted), and each IRS limit's value by `"year|type"` — the community
 *  file's where it has one, with the documents it cites (a link each,
 *  from the year's `sources`). Rebuilt only when the approved version
 *  changes. */
type Citation = { name: string; url: string | null };
type Shipped = {
  keys: Set<string>;
  limitValues: Map<string, number>;
  limitCitations: Map<string, Citation[]>;
  /** By year: each table section's citations (withholding, ltcg, …). */
  sectionCitations: Record<string, Partial<Record<TaxDataSection, Citation[]>>>;
};
type TaxDataSection = "withholding" | "ltcg" | "irmaa" | "fpl";
const linked = (
  source: string,
  links: Record<string, string> | undefined,
): Citation[] =>
  citationsOf(source).map((name) => ({ name, url: links?.[name] ?? null }));
let shippedCache: { version: number; shipped: Shipped } | undefined;
async function shippedData(db: Db): Promise<Shipped> {
  const [row] = (await db
    .select({ v: max(schema.taxDataUpdates.dataVersion) })
    .from(schema.taxDataUpdates)
    .where(eq(schema.taxDataUpdates.status, "applied"))) as {
    v: number | null;
  }[];
  const version = row?.v ?? 0;
  if (shippedCache?.version !== version) {
    const shippedFile = readTaxDataFile();
    const community = await approvedCommunityFile(db, shippedFile.dataVersion);
    const rows = [
      ...shippedReferenceRows(shippedFile),
      ...(community ? shippedReferenceRows(community) : []),
    ];
    shippedCache = {
      version,
      shipped: {
        keys: new Set(rows.map((r) => `${r.table}|${keyText(r.keyVals)}`)),
        // Later rows (the community file's) win.
        limitValues: new Map(
          rows
            .filter((r) => r.table === "contribution_limits")
            .map((r) => [keyText(r.keyVals), Number(r.value)]),
        ),
        limitCitations: new Map(
          [shippedFile, ...(community ? [community] : [])].flatMap((f) =>
            Object.entries(f.years).flatMap(([y, d]) =>
              Object.entries(d.limits).map(
                ([k, l]) =>
                  [
                    keyText([Number(y), k]),
                    linked(l.source, d.sources),
                  ] as const,
              ),
            ),
          ),
        ),
        // Later files (the community one) win, year by year.
        sectionCitations: Object.assign(
          {},
          ...[shippedFile, ...(community ? [community] : [])].map((f) =>
            Object.fromEntries(
              Object.entries(f.years).map(([y, d]) => [
                y,
                Object.fromEntries(
                  (["withholding", "ltcg", "irmaa", "fpl"] as const).flatMap(
                    (s) => (d[s] ? [[s, linked(d[s]!.source, d.sources)]] : []),
                  ),
                ),
              ]),
            ),
          ),
        ),
      },
    };
  }
  return shippedCache.shipped;
}

/** Does the tax data ship this row (same table and key)? */
function isShipped(
  table: keyof typeof SHIPPED_KEY,
  row: Record<string, unknown>,
  shipped: Shipped,
): boolean {
  return shipped.keys.has(
    `${table}|${keyText(SHIPPED_KEY[table].cols.map((c) => row[c]))}`,
  );
}

/** Fields an edit sets: always the confirmation; `origin='user'` only when
 *  the figure actually changed (an unchanged save must not freeze a
 *  shipped figure against future corrections). */
function editProvenance(
  spec: RefTable,
  before: Record<string, unknown> | undefined,
  next: unknown,
) {
  const changed =
    !before || !sameReferenceValue(before[spec.value], next, spec.json);
  return {
    confirmedAt: new Date(),
    ...(changed && { origin: "user" as const }),
  };
}

/** A shipped figure can't be deleted (the next start would add it back);
 *  reset it to the shipped value instead. */
async function refuseShippedDelete(
  db: Db,
  table: keyof typeof SHIPPED_KEY,
  row: Record<string, unknown> | undefined,
) {
  if (row && isShipped(table, row, await shippedData(db)))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Ledgr ships this figure — use Reset to shipped instead of deleting it.",
    });
}

/** `carried`: a "+Year" copy or an empty placeholder — carried forward
 *  until the real figure ships (a release replaces it) rather than the
 *  household's own. A carried row confirmed unchanged stays carried: it
 *  only becomes the household's when its value is actually changed. */
const carriedInput = { carried: z.boolean().optional() };
const createProvenance = (carried: boolean | undefined) =>
  carried
    ? { origin: "carried" as const }
    : { origin: "user" as const, confirmedAt: new Date() };

// --- Zod schemas ---

const contributionLimitInput = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  limitType: z.string().min(1),
  value: zDecimal,
  notes: z.string().nullable().optional(),
});

const taxBracketInput = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]),
  w4Checkbox: z.boolean(),
  brackets: taxBracketsSchema,
});

const ltcgBracketInput = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]),
  brackets: ltcgBracketsSchema,
});

const irmaaBracketInput = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]),
  brackets: irmaaBracketsSchema,
});

const fplByHouseholdInput = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  amounts: fplByHouseholdAmountsSchema,
});

// --- Procedures ---

/** The five yearly tables, as the status and Add year see them. */
const YEARLY_TABLES = {
  contribution_limits: schema.contributionLimits,
  tax_brackets: schema.taxBrackets,
  ltcg_brackets: schema.ltcgBrackets,
  irmaa_brackets: schema.irmaaBrackets,
  fpl_by_household: schema.fplByHousehold,
} as const;
type YearlyTable = keyof typeof YEARLY_TABLES;
const yearlyTableSchema = z.enum(
  Object.keys(YEARLY_TABLES) as [YearlyTable, ...YearlyTable[]],
);

/** A carried figure's name, as the checklist shows it. */
function carriedName(table: YearlyTable, row: Record<string, unknown>) {
  if (table === "contribution_limits")
    return taxLimitKey(String(row.limitType))?.label ?? String(row.limitType);
  if (table === "fpl_by_household") return "Poverty levels by household size";
  const status = String(row.filingStatus);
  if (table === "tax_brackets")
    return `${status} withholding${row.w4Checkbox ? " (W-4 box 2(c))" : ""}`;
  return status;
}

export const taxLimitsProcedures = {
  /** Is the tax data current, and what was carried forward? */
  taxData: createTRPCRouter({
    /** The documents each year's shipped tables cite, linked. */
    sectionSources: protectedProcedure.query(
      async ({ ctx }) => (await shippedData(ctx.db)).sectionCitations,
    ),
    status: protectedProcedure.query(async ({ ctx }) => {
      const yearsByTable: Partial<Record<YearlyTable, number[]>> = {};
      const carried: CarriedFigure[] = [];
      const carriedRows: {
        table: YearlyTable;
        id: number;
        taxYear: number;
        name: string;
      }[] = [];
      for (const [name, table] of Object.entries(YEARLY_TABLES) as [
        YearlyTable,
        (typeof YEARLY_TABLES)[YearlyTable],
      ][]) {
        const rows = (await ctx.db.select().from(table)) as Record<
          string,
          unknown
        >[];
        yearsByTable[name] = [...new Set(rows.map((r) => Number(r.taxYear)))];
        for (const r of rows)
          if (r.origin === "carried" && r.confirmedAt == null) {
            const label = carriedName(name, r);
            carried.push({
              table: name,
              taxYear: Number(r.taxYear),
              name: label,
            });
            carriedRows.push({
              table: name,
              id: Number(r.id),
              taxYear: Number(r.taxYear),
              name: label,
            });
          }
      }
      const base = taxDataStatus({ yearsByTable, carried });
      // A community update waiting for review needs attention too.
      const pending = await pendingUpdate(ctx.db);
      const status = pending
        ? {
            ...base,
            needsAttention: true,
            summary: [base.summary, "tax data update to review"]
              .filter(Boolean)
              .join("; "),
          }
        : base;
      return {
        ...status,
        sections: status.sections.map(({ upcoming, ...s }) => ({
          ...s,
          upcoming: upcoming
            ? { year: upcoming.year, due: localDateStr(upcoming.due) }
            : null,
        })),
        carriedRows,
      };
    }),

    /** Start a year in one step: every table copies its newest earlier
     *  year as carried forward (replaced when the real figures ship).
     *  Tables that already have the year are left alone. */
    addYear: adminProcedure
      .input(z.object({ year: z.number().int().min(2000).max(2100) }))
      .mutation(async ({ ctx, input }) => {
        const copied: Partial<Record<YearlyTable, number | null>> = {};
        for (const [name, table] of Object.entries(YEARLY_TABLES) as [
          YearlyTable,
          (typeof YEARLY_TABLES)[YearlyTable],
        ][]) {
          const rows = (await ctx.db.select().from(table)) as Record<
            string,
            unknown
          >[];
          const years = [...new Set(rows.map((r) => Number(r.taxYear)))];
          if (years.includes(input.year)) continue;
          const earlier = years.filter((y) => y < input.year);
          const from = earlier.length
            ? Math.max(...earlier)
            : years.length
              ? Math.min(...years)
              : null;
          copied[name] = from;
          if (from === null) continue;
          const copies = rows
            .filter((r) => Number(r.taxYear) === from)
            .map(
              ({
                id: _id,
                origin: _o,
                sourceVersion: _v,
                confirmedAt: _c,
                ...r
              }) => ({
                ...r,
                taxYear: input.year,
                origin: "carried" as const,
              }),
            );
          if (copies.length) await ctx.db.insert(table).values(copies as never);
        }
        return { copied };
      }),

    /** The household checked a carried figure: it stays carried (the real
     *  figure replaces it when it ships), but no longer needs attention. */
    confirm: adminProcedure
      .input(z.object({ table: yearlyTableSchema, id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const table = YEARLY_TABLES[input.table];
        await ctx.db
          .update(table)
          .set({ confirmedAt: new Date() } as never)
          .where(eq(table.id, input.id));
      }),
  }),

  contributionLimits: createTRPCRouter({
    /** Each row says whether Ledgr ships it (Reset to shipped vs delete). */
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.contributionLimits)
        .orderBy(
          asc(schema.contributionLimits.taxYear),
          asc(schema.contributionLimits.limitType),
        );
      const shipped = await shippedData(ctx.db);
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("contribution_limits", r, shipped),
        /** What Ledgr ships for this figure (null if it doesn't). */
        shippedValue:
          shipped.limitValues.get(keyText([r.taxYear, r.limitType])) ?? null,
        /** The documents Ledgr's figure cites, each with its link. */
        shippedSources:
          shipped.limitCitations.get(keyText([r.taxYear, r.limitType])) ?? [],
      }));
    }),
    create: adminProcedure
      .input(contributionLimitInput.extend(carriedInput))
      .mutation(({ ctx, input: { carried, ...input } }) =>
        ctx.db
          .insert(schema.contributionLimits)
          .values({ ...input, ...createProvenance(carried) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(contributionLimitInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [before] = await ctx.db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.id, id));
        return ctx.db
          .update(schema.contributionLimits)
          .set({
            ...data,
            ...editProvenance(
              SHIPPED_KEY.contribution_limits,
              before,
              data.value,
            ),
          })
          .where(eq(schema.contributionLimits.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.id, input.id));
        await refuseShippedDelete(ctx.db, "contribution_limits", row);
        return ctx.db
          .delete(schema.contributionLimits)
          .where(eq(schema.contributionLimits.id, input.id));
      }),
    /** Hand a shipped figure back to the tax-data file: the reconcile puts
     *  the shipped value back now (and keeps it current from then on). */
    resetToShipped: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.contributionLimits)
          .where(eq(schema.contributionLimits.id, input.id));
        if (
          !row ||
          !isShipped("contribution_limits", row, await shippedData(ctx.db))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ledgr doesn't ship this figure.",
          });
        await ctx.db
          .update(schema.contributionLimits)
          .set({ origin: "seed", sourceVersion: 0, confirmedAt: null })
          .where(eq(schema.contributionLimits.id, input.id));
        await reconcileReferenceData(ctx.db);
      }),
  }),

  taxBrackets: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.taxBrackets)
        .orderBy(
          asc(schema.taxBrackets.taxYear),
          asc(schema.taxBrackets.filingStatus),
        );
      const shipped = await shippedData(ctx.db);
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("tax_brackets", r, shipped),
      }));
    }),
    create: adminProcedure
      .input(taxBracketInput.extend(carriedInput))
      .mutation(({ ctx, input: { carried, ...input } }) =>
        ctx.db
          .insert(schema.taxBrackets)
          .values({ ...input, ...createProvenance(carried) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(taxBracketInput.shape))
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [before] = await ctx.db
          .select()
          .from(schema.taxBrackets)
          .where(eq(schema.taxBrackets.id, id));
        return ctx.db
          .update(schema.taxBrackets)
          .set({
            ...data,
            ...editProvenance(SHIPPED_KEY.tax_brackets, before, data.brackets),
          })
          .where(eq(schema.taxBrackets.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.taxBrackets)
          .where(eq(schema.taxBrackets.id, input.id));
        await refuseShippedDelete(ctx.db, "tax_brackets", row);
        return ctx.db
          .delete(schema.taxBrackets)
          .where(eq(schema.taxBrackets.id, input.id));
      }),
    /** Hand a shipped figure back to the tax-data file: the reconcile puts
     *  the shipped value back now (and keeps it current from then on). */
    resetToShipped: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.taxBrackets)
          .where(eq(schema.taxBrackets.id, input.id));
        if (!row || !isShipped("tax_brackets", row, await shippedData(ctx.db)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ledgr doesn't ship this figure.",
          });
        await ctx.db
          .update(schema.taxBrackets)
          .set({ origin: "seed", sourceVersion: 0, confirmedAt: null })
          .where(eq(schema.taxBrackets.id, input.id));
        await reconcileReferenceData(ctx.db);
      }),
  }),

  ltcgBrackets: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.ltcgBrackets)
        .orderBy(
          asc(schema.ltcgBrackets.taxYear),
          asc(schema.ltcgBrackets.filingStatus),
        );
      const shipped = await shippedData(ctx.db);
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("ltcg_brackets", r, shipped),
      }));
    }),
    create: adminProcedure
      .input(ltcgBracketInput.extend(carriedInput))
      .mutation(({ ctx, input: { carried, ...input } }) =>
        ctx.db
          .insert(schema.ltcgBrackets)
          .values({ ...input, ...createProvenance(carried) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(ltcgBracketInput.shape))
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [before] = await ctx.db
          .select()
          .from(schema.ltcgBrackets)
          .where(eq(schema.ltcgBrackets.id, id));
        return ctx.db
          .update(schema.ltcgBrackets)
          .set({
            ...data,
            ...editProvenance(SHIPPED_KEY.ltcg_brackets, before, data.brackets),
          })
          .where(eq(schema.ltcgBrackets.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.ltcgBrackets)
          .where(eq(schema.ltcgBrackets.id, input.id));
        await refuseShippedDelete(ctx.db, "ltcg_brackets", row);
        return ctx.db
          .delete(schema.ltcgBrackets)
          .where(eq(schema.ltcgBrackets.id, input.id));
      }),
    /** Hand a shipped figure back to the tax-data file: the reconcile puts
     *  the shipped value back now (and keeps it current from then on). */
    resetToShipped: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.ltcgBrackets)
          .where(eq(schema.ltcgBrackets.id, input.id));
        if (!row || !isShipped("ltcg_brackets", row, await shippedData(ctx.db)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ledgr doesn't ship this figure.",
          });
        await ctx.db
          .update(schema.ltcgBrackets)
          .set({ origin: "seed", sourceVersion: 0, confirmedAt: null })
          .where(eq(schema.ltcgBrackets.id, input.id));
        await reconcileReferenceData(ctx.db);
      }),
  }),

  irmaaBrackets: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.irmaaBrackets)
        .orderBy(
          asc(schema.irmaaBrackets.taxYear),
          asc(schema.irmaaBrackets.filingStatus),
        );
      const shipped = await shippedData(ctx.db);
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("irmaa_brackets", r, shipped),
      }));
    }),
    create: adminProcedure
      .input(irmaaBracketInput.extend(carriedInput))
      .mutation(({ ctx, input: { carried, ...input } }) =>
        ctx.db
          .insert(schema.irmaaBrackets)
          .values({ ...input, ...createProvenance(carried) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(irmaaBracketInput.shape))
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [before] = await ctx.db
          .select()
          .from(schema.irmaaBrackets)
          .where(eq(schema.irmaaBrackets.id, id));
        return ctx.db
          .update(schema.irmaaBrackets)
          .set({
            ...data,
            ...editProvenance(
              SHIPPED_KEY.irmaa_brackets,
              before,
              data.brackets,
            ),
          })
          .where(eq(schema.irmaaBrackets.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.irmaaBrackets)
          .where(eq(schema.irmaaBrackets.id, input.id));
        await refuseShippedDelete(ctx.db, "irmaa_brackets", row);
        return ctx.db
          .delete(schema.irmaaBrackets)
          .where(eq(schema.irmaaBrackets.id, input.id));
      }),
    /** Hand a shipped figure back to the tax-data file: the reconcile puts
     *  the shipped value back now (and keeps it current from then on). */
    resetToShipped: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.irmaaBrackets)
          .where(eq(schema.irmaaBrackets.id, input.id));
        if (
          !row ||
          !isShipped("irmaa_brackets", row, await shippedData(ctx.db))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ledgr doesn't ship this figure.",
          });
        await ctx.db
          .update(schema.irmaaBrackets)
          .set({ origin: "seed", sourceVersion: 0, confirmedAt: null })
          .where(eq(schema.irmaaBrackets.id, input.id));
        await reconcileReferenceData(ctx.db);
      }),
  }),

  fplByHousehold: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.fplByHousehold)
        .orderBy(asc(schema.fplByHousehold.taxYear));
      const shipped = await shippedData(ctx.db);
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("fpl_by_household", r, shipped),
      }));
    }),
    create: adminProcedure
      .input(fplByHouseholdInput.extend(carriedInput))
      .mutation(({ ctx, input: { carried, ...input } }) =>
        ctx.db
          .insert(schema.fplByHousehold)
          .values({ ...input, ...createProvenance(carried) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(fplByHouseholdInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [before] = await ctx.db
          .select()
          .from(schema.fplByHousehold)
          .where(eq(schema.fplByHousehold.id, id));
        return ctx.db
          .update(schema.fplByHousehold)
          .set({
            ...data,
            ...editProvenance(
              SHIPPED_KEY.fpl_by_household,
              before,
              data.amounts,
            ),
          })
          .where(eq(schema.fplByHousehold.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.fplByHousehold)
          .where(eq(schema.fplByHousehold.id, input.id));
        await refuseShippedDelete(ctx.db, "fpl_by_household", row);
        return ctx.db
          .delete(schema.fplByHousehold)
          .where(eq(schema.fplByHousehold.id, input.id));
      }),
    /** Hand a shipped figure back to the tax-data file: the reconcile puts
     *  the shipped value back now (and keeps it current from then on). */
    resetToShipped: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(schema.fplByHousehold)
          .where(eq(schema.fplByHousehold.id, input.id));
        if (
          !row ||
          !isShipped("fpl_by_household", row, await shippedData(ctx.db))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ledgr doesn't ship this figure.",
          });
        await ctx.db
          .update(schema.fplByHousehold)
          .set({ origin: "seed", sourceVersion: 0, confirmedAt: null })
          .where(eq(schema.fplByHousehold.id, input.id));
        await reconcileReferenceData(ctx.db);
      }),
  }),
};
