/** Historical data router providing year-end balance history, salary timelines, home improvements, other assets, and historical notes management. */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { num, buildYearEndHistory } from "@/server/helpers";

export const historicalRouter = createTRPCRouter({
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const [
      yearEndHistory,
      people,
      jobs,
      salaryChanges,
      homeImprovements,
      otherAssets,
      notes,
    ] = await Promise.all([
      buildYearEndHistory(ctx.db),
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
      ctx.db.select().from(schema.jobs).orderBy(asc(schema.jobs.startDate)),
      ctx.db
        .select()
        .from(schema.salaryChanges)
        .orderBy(asc(schema.salaryChanges.effectiveDate)),
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

    // Salary history: build timeline per person
    const salaryHistory = people.map((person) => {
      const personJobs = jobs.filter((j) => j.personId === person.id);
      const timeline: {
        employer: string;
        startDate: string;
        endDate: string | null;
        salary: number;
        changes: {
          effectiveDate: string;
          newSalary: number;
          reason: string | null;
        }[];
      }[] = [];

      for (const job of personJobs) {
        const jobChanges = salaryChanges
          .filter((sc) => sc.jobId === job.id)
          .map((sc) => ({
            effectiveDate: sc.effectiveDate,
            newSalary: num(sc.newSalary),
            reason: sc.notes,
          }));

        timeline.push({
          employer: job.employerName,
          startDate: job.startDate,
          endDate: job.endDate,
          salary: num(job.annualSalary),
          changes: jobChanges,
        });
      }

      return { person: { id: person.id, name: person.name }, timeline };
    });

    // Build salary lookup: year → person → salary (for table display)
    const salaryByYear = new Map<number, Map<string, number>>();
    for (const person of salaryHistory) {
      for (const job of person.timeline) {
        const startYear = new Date(job.startDate).getFullYear();
        const endYear = job.endDate
          ? new Date(job.endDate).getFullYear()
          : new Date().getFullYear();
        for (let y = startYear; y <= endYear; y++) {
          if (!salaryByYear.has(y)) salaryByYear.set(y, new Map());
          let salary = job.salary;
          for (const ch of job.changes) {
            if (new Date(ch.effectiveDate).getFullYear() <= y)
              salary = ch.newSalary;
          }
          salaryByYear.get(y)!.set(person.person.name, salary);
        }
      }
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
        (sum, hi) => sum + num(hi.cost),
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
      const items: { name: string; value: number; note: string | null }[] = [];
      for (const name of uniqueAssetNames) {
        // Find the most recent entry for this asset at or before this year
        const entries = otherAssets.filter(
          (a) => a.name === name && a.year <= year,
        );
        if (entries.length > 0) {
          const latest = entries[entries.length - 1]!; // already sorted by year asc
          const val = num(latest.value);
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
            cost: num(i.cost),
            note: i.note,
          })) ?? [],
        otherAssets:
          oaData && oaData.items.length > 0 ? oaData.total : row.otherAssets,
        otherAssetItems: oaData?.items ?? [],
        salaries,
      };
    });

    // Serialize notes as a flat object for the client
    const notesObj: Record<string, string> = {};
    for (const [key, value] of Array.from(notesMap.entries())) {
      notesObj[key] = value;
    }

    return { history, salaryHistory, notes: notesObj };
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
