import { redundantReturnRateIds } from "@/lib/pure/simulation/return-rate-breakpoints";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zDecimal } from "@/lib/utils/zod-fields";
import type { Db } from "@/lib/db";

// retirementScenarioInput removed with the retirementScenarios router
// (Retirement Profiles step B) — nothing writes that table any more.

const returnRateInput = z.object({
  age: z.number().int(),
  rateOfReturn: zDecimal,
});

/** Remove breakpoints that repeat the previous rate — one entry per run of
 *  equal rates (lib/pure/simulation/return-rate-breakpoints.ts). */
async function collapseReturnRates(db: Db) {
  const ids = redundantReturnRateIds(
    await db.select().from(schema.returnRateTable),
  );
  if (ids.length > 0)
    await db
      .delete(schema.returnRateTable)
      .where(inArray(schema.returnRateTable.id, ids));
}

export const returnRateProcedures = {
  returnRates: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.returnRateTable)
        .orderBy(asc(schema.returnRateTable.age)),
    ),
    upsert: adminProcedure.input(returnRateInput).mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.returnRateTable)
          .where(eq(schema.returnRateTable.age, input.age));
        const row =
          existing.length > 0
            ? await tx
                .update(schema.returnRateTable)
                .set(input)
                .where(eq(schema.returnRateTable.age, input.age))
                .returning()
                .then((r) => r[0])
            : await tx
                .insert(schema.returnRateTable)
                .values(input)
                .returning()
                .then((r) => r[0]);
        await collapseReturnRates(tx);
        return row;
      }),
    ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          await tx
            .delete(schema.returnRateTable)
            .where(eq(schema.returnRateTable.id, input.id));
          await collapseReturnRates(tx);
        }),
      ),
  }),
};
