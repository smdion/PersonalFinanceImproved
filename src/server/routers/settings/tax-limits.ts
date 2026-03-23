import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
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
} from "@/lib/db/json-schemas";

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

// --- Procedures ---

export const taxLimitsProcedures = {
  contributionLimits: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.contributionLimits)
        .orderBy(
          asc(schema.contributionLimits.taxYear),
          asc(schema.contributionLimits.limitType),
        ),
    ),
    create: adminProcedure
      .input(contributionLimitInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.contributionLimits)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(contributionLimitInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.contributionLimits)
          .set(data)
          .where(eq(schema.contributionLimits.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.contributionLimits)
          .where(eq(schema.contributionLimits.id, input.id)),
      ),
  }),

  taxBrackets: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.taxBrackets)
        .orderBy(
          asc(schema.taxBrackets.taxYear),
          asc(schema.taxBrackets.filingStatus),
        ),
    ),
    create: adminProcedure.input(taxBracketInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.taxBrackets)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(taxBracketInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.taxBrackets)
          .set(data)
          .where(eq(schema.taxBrackets.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.taxBrackets)
          .where(eq(schema.taxBrackets.id, input.id)),
      ),
  }),

  ltcgBrackets: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.ltcgBrackets)
        .orderBy(
          asc(schema.ltcgBrackets.taxYear),
          asc(schema.ltcgBrackets.filingStatus),
        ),
    ),
    create: adminProcedure
      .input(ltcgBracketInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.ltcgBrackets)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(ltcgBracketInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.ltcgBrackets)
          .set(data)
          .where(eq(schema.ltcgBrackets.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.ltcgBrackets)
          .where(eq(schema.ltcgBrackets.id, input.id)),
      ),
  }),

  irmaaBrackets: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.irmaaBrackets)
        .orderBy(
          asc(schema.irmaaBrackets.taxYear),
          asc(schema.irmaaBrackets.filingStatus),
        ),
    ),
    create: adminProcedure
      .input(irmaaBracketInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.irmaaBrackets)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({ id: z.number().int() }).extend(irmaaBracketInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.irmaaBrackets)
          .set(data)
          .where(eq(schema.irmaaBrackets.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.irmaaBrackets)
          .where(eq(schema.irmaaBrackets.id, input.id)),
      ),
  }),
};
