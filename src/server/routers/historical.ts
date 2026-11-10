/** Historical data router providing year-end balance history, per-person salary/bonus records, home improvements, other assets, and historical notes management. */
import { calendarYear } from "@/lib/utils/date";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { zYear } from "@/lib/utils/zod-fields";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { upsertHistoricalNote } from "@/server/data/historical-notes";
import { loadYearAssets } from "@/server/services/net-worth/year-assets";
import { toNumber } from "@/lib/utils/numbers";
import { getAllPeople } from "@/server/data/people";
import { resolveCompensation } from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import { findActiveJob } from "@/lib/pure/household/profiles";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";

export const historicalRouter = createTRPCRouter({
  /**
   * Year-end history with each year's assets, notes and per-person salaries; the current year's
   * salaries come from the active Salary Profile until they are recorded.
   */
  computeSummary: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [{ years, notes }, people, jobs, historicalSalaryRows] =
        await Promise.all([
          loadYearAssets(ctx.db, ctx.scope.asOf, input),
          getAllPeople(ctx.db),
          ctx.db.select().from(schema.jobs).orderBy(asc(schema.jobs.startDate)),
          ctx.db.select().from(schema.historicalSalaries),
        ]);

      const currentYear = ctx.scope.asOf.getFullYear();
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        null,
      );

      // Past years come only from historical_salaries. The current year fills
      // from the active Salary Profile's entry for each person's current job
      // until it is recorded; a recorded fact beats the live estimate.
      const salaryByYear = new Map<number, Map<string, number>>();
      const salaryDetailsByYear = new Map<
        number,
        Map<string, { base: number; bonus: number; total: number }>
      >();
      const personIdByName: Record<string, number> = {};
      for (const person of people) personIdByName[person.name] = person.id;

      const recordedYears = new Set<number>();
      for (const row of historicalSalaryRows) {
        const person = people.find((p) => p.id === row.personId);
        if (!person) continue;
        const base = toNumber(row.salary);
        const bonus = toNumber(row.bonus);
        if (!salaryByYear.has(row.year)) salaryByYear.set(row.year, new Map());
        if (!salaryDetailsByYear.has(row.year))
          salaryDetailsByYear.set(row.year, new Map());
        salaryByYear.get(row.year)!.set(person.name, base);
        salaryDetailsByYear
          .get(row.year)!
          .set(person.name, { base, bonus, total: base + bonus });
        if (row.year === currentYear) recordedYears.add(person.id);
      }

      for (const person of people) {
        if (recordedYears.has(person.id)) continue;
        const activeJob = findActiveJob(jobs, person.id, ctx.scope.asOf);
        const comp = activeJob
          ? resolveCompensation(salaryProfileActiveMap, activeJob.id)
          : { salary: 0, bonus: 0 };
        if (!salaryByYear.has(currentYear))
          salaryByYear.set(currentYear, new Map());
        if (!salaryDetailsByYear.has(currentYear))
          salaryDetailsByYear.set(currentYear, new Map());
        salaryByYear.get(currentYear)!.set(person.name, comp.salary);
        salaryDetailsByYear.get(currentYear)!.set(person.name, {
          base: comp.salary,
          bonus: comp.bonus,
          total: comp.salary + comp.bonus,
        });
      }

      // Merge all data into year-end rows
      const history = years.map(({ row, assets }) => {
        const salaries: Record<string, number> = {};
        const yearSalaries = salaryByYear.get(row.year);
        if (yearSalaries) {
          for (const [name, salary] of Array.from(yearSalaries.entries())) {
            salaries[name] = salary;
          }
        }

        const salaryDetails: Record<
          string,
          { base: number; bonus: number; total: number }
        > = {};
        const yearDetails = salaryDetailsByYear.get(row.year);
        if (yearDetails) {
          for (const [name, details] of Array.from(yearDetails.entries())) {
            salaryDetails[name] = details;
          }
        }

        return {
          ...row,
          homeImprovements: assets.homeImprovements,
          homeImprovementItems: assets.homeImprovementItems,
          otherAssets: assets.otherAssets,
          otherAssetItems: assets.otherAssetItems,
          salaries,
          salaryDetails,
        };
      });

      return { history, personIdByName, notes };
    }),

  /** Update editable fields on a net_worth_annual row (income/tax + otherLiabilities only). */
  update: adminProcedure
    .input(
      z.object({
        year: zYear,
        fields: z.object({
          grossIncome: z.number().optional(),
          combinedAgi: z.number().optional(),
          ssaEarnings: z.number().optional(),
          effectiveTaxRate: z.number().optional(),
          taxesPaid: z.number().optional(),
          propertyTaxes: z.number().optional(),
          otherLiabilities: z.number().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { year, fields } = input;

      // Find the row by year
      const rows = await ctx.db.select().from(schema.netWorthAnnual);
      const row = rows.find((r) => calendarYear(r.yearEndDate) === year);
      if (!row) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No year-end history found for ${year}.`,
        });
      }

      // Build update object — only include fields that were provided
      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined /* superjson keeps a key sent as undefined */) {
          updates[key] = String(value);
        }
      }

      if (Object.keys(updates).length === 0) return { ok: true };

      await ctx.db
        .update(schema.netWorthAnnual)
        .set(updates)
        .where(eq(schema.netWorthAnnual.id, row.id));

      return { ok: true };
    }),

  /**
   * Upsert one (person, year); editing `salary` or `bonus` keeps the other. With no row,
   * the other field takes `computeSummary`'s live estimate for the current year (not 0,
   * which would zero it), or 0 for a past year.
   */
  upsertSalary: adminProcedure
    .input(
      z.object({
        personId: z.number().int(),
        year: zYear,
        salary: z.number().optional(),
        bonus: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.historicalSalaries)
        .where(
          and(
            eq(schema.historicalSalaries.personId, input.personId),
            eq(schema.historicalSalaries.year, input.year),
          ),
        );

      let fallbackSalary = toNumber(existing[0]?.salary);
      let fallbackBonus = toNumber(existing[0]?.bonus);
      if (!existing[0] && input.year === ctx.scope.asOf.getFullYear()) {
        const [jobs, salaryProfileActiveMap] = await Promise.all([
          ctx.db.select().from(schema.jobs),
          loadEffectiveSalaryProfile(ctx.db, null),
        ]);
        const activeJob = findActiveJob(jobs, input.personId, ctx.scope.asOf);
        const comp = activeJob
          ? resolveCompensation(salaryProfileActiveMap, activeJob.id)
          : { salary: 0, bonus: 0 };
        fallbackSalary = comp.salary;
        fallbackBonus = comp.bonus;
      }

      const salary = (input.salary ?? fallbackSalary).toFixed(2);
      const bonus = (input.bonus ?? fallbackBonus).toFixed(2);
      const rows = await ctx.db
        .insert(schema.historicalSalaries)
        .values({ personId: input.personId, year: input.year, salary, bonus })
        .onConflictDoUpdate({
          target: [
            schema.historicalSalaries.personId,
            schema.historicalSalaries.year,
          ],
          set: { salary, bonus },
        })
        .returning();
      return rows[0]!;
    }),

  // --- Historical Notes ---

  /** Save the note on one year's field; a blank note deletes it. */
  upsertNote: adminProcedure
    .input(
      z.object({
        year: zYear,
        field: z.string().min(1),
        note: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await upsertHistoricalNote(ctx.db, input);
      return { ok: true };
    }),
});
