import type { Db } from "@/lib/db";
import { eq, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";

export async function listBrokerageGoals(ctx: { db: Db }) {
  const goals = await ctx.db
    .select()
    .from(schema.brokerageGoals)
    .where(eq(schema.brokerageGoals.isActive, true))
    .orderBy(
      asc(schema.brokerageGoals.targetYear),
      asc(schema.brokerageGoals.priority),
    );
  return goals.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: toNumber(g.targetAmount),
    targetYear: g.targetYear,
    priority: g.priority,
    isActive: g.isActive,
    notes: g.notes,
  }));
}
