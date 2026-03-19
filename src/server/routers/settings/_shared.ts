import { z } from "zod/v4";
import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { db as appDb } from "@/lib/db";
import { num } from "@/server/helpers";
import { settingValueSchema } from "@/lib/db/json-schemas";

/** Accepts both the main db instance and transaction handles. */
export type DbType = typeof appDb | Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/** Validates a string represents a valid decimal number. */
export const zDecimal = z
  .string()
  .refine((v) => !isNaN(Number(v)) && v.trim() !== "", {
    message: "Must be a valid number",
  });

/** Recompute annual_performance category rollups from account_performance for a given year. */
export async function recomputeAnnualRollups(db: DbType, year: number) {
  // Get all account_performance rows for this year
  const acctRows = await db
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.year, year));

  // Group by parentCategory
  const categoryMap = new Map<
    string,
    {
      beginBal: number;
      contribs: number;
      gainLoss: number;
      endBal: number;
      employer: number;
      distributions: number;
      fees: number;
    }
  >();
  for (const r of acctRows) {
    const cat = r.parentCategory;
    const existing = categoryMap.get(cat) ?? {
      beginBal: 0,
      contribs: 0,
      gainLoss: 0,
      endBal: 0,
      employer: 0,
      distributions: 0,
      fees: 0,
    };
    existing.beginBal += num(r.beginningBalance);
    existing.contribs += num(r.totalContributions);
    existing.gainLoss += num(r.yearlyGainLoss);
    existing.endBal += num(r.endingBalance);
    existing.employer += num(r.employerContributions);
    existing.distributions += num(r.distributions);
    existing.fees += num(r.fees);
    categoryMap.set(cat, existing);
  }

  // Also compute Portfolio = sum of all
  const portfolio = {
    beginBal: 0,
    contribs: 0,
    gainLoss: 0,
    endBal: 0,
    employer: 0,
    distributions: 0,
    fees: 0,
  };
  Array.from(categoryMap.values()).forEach((v) => {
    portfolio.beginBal += v.beginBal;
    portfolio.contribs += v.contribs;
    portfolio.gainLoss += v.gainLoss;
    portfolio.endBal += v.endBal;
    portfolio.employer += v.employer;
    portfolio.distributions += v.distributions;
    portfolio.fees += v.fees;
  });
  categoryMap.set("Portfolio", portfolio);

  // Upsert annual_performance rows
  for (const [category, totals] of Array.from(categoryMap.entries())) {
    const existing = await db
      .select()
      .from(schema.annualPerformance)
      .where(
        and(
          eq(schema.annualPerformance.year, year),
          eq(schema.annualPerformance.category, category),
        ),
      );

    const values = {
      beginningBalance: totals.beginBal.toFixed(2),
      totalContributions: totals.contribs.toFixed(2),
      yearlyGainLoss: totals.gainLoss.toFixed(2),
      endingBalance: totals.endBal.toFixed(2),
      employerContributions: totals.employer.toFixed(2),
      distributions: totals.distributions.toFixed(2),
      fees: totals.fees.toFixed(2),
    };

    if (existing.length > 0) {
      await db
        .update(schema.annualPerformance)
        .set(values)
        .where(eq(schema.annualPerformance.id, existing[0]!.id));
    }
  }
}

/** Re-export the centralized settingValue schema for backward compatibility. */
export const settingValue = settingValueSchema;
