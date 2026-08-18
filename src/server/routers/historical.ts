/** Historical data router providing year-end balance history, per-person salary/bonus records, home improvements, other assets, and historical notes management. */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber, buildYearEndHistory } from "@/server/helpers";
import {
  loadEffectiveSalaryProfile,
  resolveCompensation,
} from "@/server/helpers/salary";
import { findActiveJob } from "@/lib/pure/profiles";
import { zYearEndTargeting, toSalaryActiveMap } from "./_shared";

export const historicalRouter = createTRPCRouter({
  computeSummary: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [
        yearEndHistory,
        people,
        jobs,
        historicalSalaryRows,
        homeImprovements,
        otherAssets,
        notes,
      ] = await Promise.all([
        buildYearEndHistory(ctx.db, new Date(), {
          budgetProfileId: input?.budgetProfileId,
          budgetColumn: input?.budgetColumn,
          salaryActiveFields: toSalaryActiveMap(input?.salaryActiveFields),
        }),
        ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
        ctx.db.select().from(schema.jobs).orderBy(asc(schema.jobs.startDate)),
        ctx.db.select().from(schema.historicalSalaries),
        ctx.db
          .select()
          .from(schema.homeImprovementItems)
          .orderBy(asc(schema.homeImprovementItems.year)),
        ctx.db
          .select()
          .from(schema.otherAssetItems)
          .orderBy(asc(schema.otherAssetItems.year)),
        ctx.db.select().from(schema.historicalNotes),
      ]);

      const currentYear = new Date().getFullYear();
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        null,
      );

      // Every past year is a recorded fact, directly — historical_salaries
      // is the single source (see its schema-pg.ts comment). The in-progress
      // (current) year auto-fills from the active Salary Profile's complete
      // entry for each person's current job UNTIL it's recorded, at which
      // point the recorded fact wins (same "recorded fact beats live
      // estimate" rule as everywhere else in the app).
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
        const activeJob = findActiveJob(jobs, person.id);
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

      // Build home improvements cumulative by year
      const homeImpByYear = new Map<
        number,
        { items: typeof homeImprovements; cumulative: number }
      >();
      const allYears = yearEndHistory.map((r) => r.year);
      for (const year of allYears) {
        const itemsUpToYear = homeImprovements.filter((hi) => hi.year <= year);
        const cumulative = itemsUpToYear.reduce(
          (sum, hi) => sum + toNumber(hi.cost),
          0,
        );
        const itemsThisYear = homeImprovements.filter((hi) => hi.year === year);
        homeImpByYear.set(year, { items: itemsThisYear, cumulative });
      }

      // Build other assets by year (carry-forward: latest value per name where year <= target)
      const otherAssetsByYear = new Map<
        number,
        {
          items: { name: string; value: number; note: string | null }[];
          total: number;
        }
      >();
      const uniqueAssetNames = Array.from(
        new Set(otherAssets.map((a) => a.name)),
      );
      for (const year of allYears) {
        const items: { name: string; value: number; note: string | null }[] =
          [];
        for (const name of uniqueAssetNames) {
          // Find the most recent entry for this asset at or before this year
          const entries = otherAssets.filter(
            (a) => a.name === name && a.year <= year,
          );
          if (entries.length > 0) {
            const latest = entries[entries.length - 1]!; // already sorted by year asc
            const val = toNumber(latest.value);
            if (val > 0) {
              items.push({ name, value: val, note: latest.note });
            }
          }
        }
        otherAssetsByYear.set(year, {
          items,
          total: items.reduce((s, i) => s + i.value, 0),
        });
      }

      // Build notes lookup: year:field → note
      const notesMap = new Map<string, string>();
      for (const n of notes) {
        notesMap.set(`${n.year}:${n.field}`, n.note);
      }

      // Merge all data into year-end rows
      const history = yearEndHistory.map((row) => {
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

        const hiData = homeImpByYear.get(row.year);
        const oaData = otherAssetsByYear.get(row.year);

        return {
          ...row,
          // Override with line-item-computed values if items exist
          homeImprovements:
            hiData && hiData.items.length > 0
              ? hiData.cumulative
              : row.homeImprovements,
          homeImprovementItems:
            hiData?.items.map((i) => ({
              id: i.id,
              year: i.year,
              description: i.description,
              cost: toNumber(i.cost),
              note: i.note,
            })) ?? [],
          otherAssets:
            oaData && oaData.items.length > 0 ? oaData.total : row.otherAssets,
          otherAssetItems: oaData?.items ?? [],
          salaries,
          salaryDetails,
        };
      });

      // Serialize notes as a flat object for the client
      const notesObj: Record<string, string> = {};
      for (const [key, value] of Array.from(notesMap.entries())) {
        notesObj[key] = value;
      }

      return { history, personIdByName, notes: notesObj };
    }),

  /** Update editable fields on a net_worth_annual row (income/tax + otherLiabilities only). */
  update: adminProcedure
    .input(
      z.object({
        year: z.number(),
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
      const row = rows.find(
        (r) => new Date(r.yearEndDate).getFullYear() === year,
      );
      if (!row) {
        throw new Error(`No net_worth_annual row found for year ${year}`);
      }

      // Build update object — only include fields that were provided
      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates[key] = String(value);
        }
      }

      if (Object.keys(updates).length === 0) return { success: true };

      await ctx.db
        .update(schema.netWorthAnnual)
        .set(updates)
        .where(eq(schema.netWorthAnnual.id, row.id));

      return { success: true };
    }),

  /**
   * One control per (person, year) — upsert so the caller never has to know
   * whether a row already exists for that year. Editing just `salary` or
   * just `bonus` (the Year-End History table's two separate columns) leaves
   * the other field at whatever it already was.
   *
   * When there's no existing row to preserve a value from, the untouched
   * field falls back to the SAME live estimate the current-year auto-fill
   * in `computeSummary` shows (active job's compensation under the active
   * Salary Profile) for the current year, or 0 for a past year with no
   * prior record — never a bare 0 for the current year, which would
   * silently zero out whichever field the user wasn't editing.
   */
  upsertSalary: adminProcedure
    .input(
      z.object({
        personId: z.number().int(),
        year: z.number().int().min(1900).max(2100),
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
      if (!existing[0] && input.year === new Date().getFullYear()) {
        const [jobs, salaryProfileActiveMap] = await Promise.all([
          ctx.db.select().from(schema.jobs),
          loadEffectiveSalaryProfile(ctx.db, null),
        ]);
        const activeJob = findActiveJob(jobs, input.personId);
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

  upsertNote: adminProcedure
    .input(
      z.object({
        year: z.number(),
        field: z.string().min(1),
        note: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.note.trim() === "") {
        // Delete the note if empty
        await ctx.db
          .delete(schema.historicalNotes)
          .where(
            and(
              eq(schema.historicalNotes.year, input.year),
              eq(schema.historicalNotes.field, input.field),
            ),
          );
      } else {
        await ctx.db
          .insert(schema.historicalNotes)
          .values({ year: input.year, field: input.field, note: input.note })
          .onConflictDoUpdate({
            target: [schema.historicalNotes.year, schema.historicalNotes.field],
            set: { note: input.note },
          });
      }
      return { success: true };
    }),
});
