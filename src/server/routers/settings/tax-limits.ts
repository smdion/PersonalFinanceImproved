import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
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
  readTaxDataFile,
  reconcileReferenceData,
} from "@/lib/db/reference-data";

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

/** `table|key` of every row the tax-data file ships — the file is fixed
 *  per image, so it's read once. */
let shippedKeyCache: Set<string> | undefined;
function shippedKeys(): Set<string> {
  shippedKeyCache ??= new Set(
    shippedReferenceRows(readTaxDataFile()).map(
      (r) => `${r.table}|${keyText(r.keyVals)}`,
    ),
  );
  return shippedKeyCache;
}

/** Does the tax-data file ship this row (same table and key)? */
function isShipped(
  table: keyof typeof SHIPPED_KEY,
  row: Record<string, unknown>,
  shipped: Set<string> = shippedKeys(),
): boolean {
  return shipped.has(
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
function refuseShippedDelete(
  table: keyof typeof SHIPPED_KEY,
  row: Record<string, unknown> | undefined,
) {
  if (row && isShipped(table, row))
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

export const taxLimitsProcedures = {
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
      const shipped = shippedKeys();
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("contribution_limits", r, shipped),
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
        refuseShippedDelete("contribution_limits", row);
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
        if (!row || !isShipped("contribution_limits", row))
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
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("tax_brackets", r),
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
        refuseShippedDelete("tax_brackets", row);
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
        if (!row || !isShipped("tax_brackets", row))
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
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("ltcg_brackets", r),
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
        refuseShippedDelete("ltcg_brackets", row);
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
        if (!row || !isShipped("ltcg_brackets", row))
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
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("irmaa_brackets", r),
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
        refuseShippedDelete("irmaa_brackets", row);
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
        if (!row || !isShipped("irmaa_brackets", row))
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
      return rows.map((r) => ({
        ...r,
        shipped: isShipped("fpl_by_household", r),
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
        refuseShippedDelete("fpl_by_household", row);
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
        if (!row || !isShipped("fpl_by_household", row))
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
