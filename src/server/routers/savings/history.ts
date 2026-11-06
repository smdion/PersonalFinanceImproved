import { eq, sql } from "drizzle-orm";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";

export const historyProcedures = {
  /** All recorded monthly balances for active savings goals (for history view). */
  getMonthlyHistory: protectedProcedure.query(async ({ ctx }) => {
    const activeGoals = await ctx.db
      .select({ id: schema.savingsGoals.id })
      .from(schema.savingsGoals)
      .where(eq(schema.savingsGoals.isActive, true));

    if (activeGoals.length === 0) return { rows: [] };

    const { isPostgres } = await import("@/lib/db/dialect");
    const { queryRaw } = await import("@/lib/db/compat");
    const ids = activeGoals.map((g) => g.id);
    const inList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

    type MonthlyRow = { goal_id: number; month_date: string; balance: number };
    const rows = isPostgres()
      ? await queryRaw<MonthlyRow>(
          ctx.db,
          sql`
          SELECT goal_id, month_date::text, balance::numeric
          FROM savings_monthly
          WHERE goal_id IN (${inList})
          ORDER BY month_date ASC
        `,
        )
      : await queryRaw<MonthlyRow>(
          ctx.db,
          sql`
          SELECT goal_id, month_date, CAST(balance AS REAL) AS balance
          FROM savings_monthly
          WHERE goal_id IN (${inList})
          ORDER BY month_date ASC
        `,
        );

    return {
      rows: rows.map((r) => ({
        goalId: r.goal_id,
        monthDate: r.month_date,
        balance: Number(r.balance),
      })),
    };
  }),
};
