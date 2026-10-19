/**
 * Holding history per tracked account (portfolioProcedure — fund names and
 * shares of each account): observed periods derived from daily holdings,
 * plus periods the household enters for the years before them (or for an
 * account with no feed). Rules live in lib/pure/holding-periods.ts.
 */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  deriveObservedPeriods,
  validateHoldingPeriod,
  type HoldingPeriod,
} from "@/lib/pure/holding-periods";
import { fetchFundTickers } from "@/lib/sec/client";
import { getSecContact } from "@/lib/sec/connection";
import { syncSecurityFacts } from "@/lib/sec/facts-sync";
import { inferSecurityKind } from "@/lib/pure/simplefin-holdings";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import { toNumber } from "@/server/helpers/transforms";
import { toFactRows } from "@/server/helpers/fund-facts";
import { effectiveFacts } from "@/lib/pure/fund-facts";
import { localDateStr } from "@/lib/utils/date";
import { loadAccounts } from "./_shared";

type Db = typeof import("@/lib/db").db;

const PROBLEM_TEXT: Record<string, string> = {
  weightsDontSum: "The funds' shares must add up to 100%",
  badWeight: "Each fund's share must be above 0% and at most 100%",
  endBeforeStart: "The end date is before the start date",
  overlapsEntered: "This overlaps another period you entered for the account",
  noFunds: "Add at least one fund",
  duplicateFund: "A fund is listed twice",
};

const periodInput = z.object({
  id: z.number().int().nullable(),
  performanceAccountId: z.number().int(),
  start: z.iso.date(),
  end: z.iso.date().nullable(),
  notes: z.string().trim().max(500).nullable(),
  weights: z
    .array(
      z.object({
        securityId: z.number().int(),
        weight: z.number().gt(0).lte(1),
      }),
    )
    .min(1),
});

/** Every account's observed periods, from daily holdings of counted feeds. */
async function loadObservedPeriods(db: Db): Promise<HoldingPeriod[]> {
  const accounts = await loadAccounts(db);
  const h = schema.holdingObservations;
  const rows = await db
    .select({
      simplefinAccountId: h.simplefinAccountId,
      securityId: h.securityId,
      asOf: h.asOf,
      shares: h.shares,
      value: h.reportedMarketValue,
    })
    .from(h)
    .where(sql`${h.simplefinAccountId} IS NOT NULL`);
  const positions = [];
  const latest = new Map<number, string>();
  for (const r of rows) {
    const perf = accounts.get(r.simplefinAccountId!)?.performanceAccountId;
    if (perf == null || toNumber(r.shares) === 0) continue;
    positions.push({
      performanceAccountId: perf,
      day: r.asOf,
      securityId: r.securityId,
      value: r.value === null ? 0 : toNumber(r.value),
    });
    if (!latest.has(perf) || r.asOf > latest.get(perf)!)
      latest.set(perf, r.asOf);
  }
  return deriveObservedPeriods(positions, latest);
}

async function loadEnteredPeriods(
  db: Db,
  performanceAccountId?: number,
): Promise<(HoldingPeriod & { notes: string | null })[]> {
  const p = schema.holdingPeriods;
  const periods = await db
    .select()
    .from(p)
    .where(
      performanceAccountId === undefined
        ? undefined
        : eq(p.performanceAccountId, performanceAccountId),
    );
  if (periods.length === 0) return [];
  const weights = await db
    .select()
    .from(schema.holdingPeriodWeights)
    .where(
      inArray(
        schema.holdingPeriodWeights.holdingPeriodId,
        periods.map((x) => x.id),
      ),
    );
  return periods.map((x) => ({
    id: x.id,
    performanceAccountId: x.performanceAccountId,
    start: x.startDate,
    end: x.endDate,
    basis: x.basis,
    notes: x.notes,
    weights: Object.fromEntries(
      weights
        .filter((w) => w.holdingPeriodId === x.id)
        .map((w) => [w.securityId, toNumber(w.weight)]),
    ),
  }));
}

export const investmentHoldingPeriodsRouter = createTRPCRouter({
  /** Periods (observed + entered) per account, and the funds they name. */
  listHoldingPeriods: portfolioProcedure.query(async ({ ctx }) => {
    const [observed, entered, names] = await Promise.all([
      loadObservedPeriods(ctx.db),
      loadEnteredPeriods(ctx.db),
      loadTrackedAccountNames(ctx.db),
    ]);
    const periods = [...observed, ...entered];
    const ids = [
      ...new Set(periods.flatMap((x) => Object.keys(x.weights).map(Number))),
    ];
    const [funds, factRows] = await Promise.all([
      ctx.db
        .select({
          id: schema.securities.id,
          name: schema.securities.name,
          ticker: schema.securities.ticker,
        })
        .from(schema.securities),
      ids.length
        ? ctx.db
            .select()
            .from(schema.securityFacts)
            .where(inArray(schema.securityFacts.securityId, ids))
        : Promise.resolve([]),
    ]);
    const today = localDateStr();
    return {
      accounts: [...names.entries()].map(([id, label]) => ({ id, label })),
      periods: periods.sort(
        (a, b) =>
          a.performanceAccountId - b.performanceAccountId ||
          a.start.localeCompare(b.start),
      ),
      /** Every known fund — for picking; ones in a period first. */
      funds: funds
        .map((f) => ({
          id: f.id,
          label: f.ticker ? `${f.ticker} — ${f.name}` : f.name,
          inPeriods: ids.includes(f.id),
          /** Fee and mix (funds named in a period only). */
          facts: ids.includes(f.id)
            ? effectiveFacts(
                toFactRows(factRows.filter((r) => r.securityId === f.id)),
                today,
              )
            : null,
        }))
        .sort(
          (a, b) =>
            Number(b.inPeriods) - Number(a.inPeriods) ||
            a.label.localeCompare(b.label),
        ),
    };
  }),

  /** Create or update an entered period with its funds, in one transaction. */
  saveHoldingPeriod: portfolioProcedure
    .input(periodInput)
    .mutation(async ({ ctx, input }) => {
      const others = (
        await loadEnteredPeriods(ctx.db, input.performanceAccountId)
      ).filter((x) => x.basis === "user");
      const problems = validateHoldingPeriod(input, others);
      if (problems.length > 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: problems.map((p) => PROBLEM_TEXT[p] ?? p).join("; "),
        });
      return ctx.db.transaction(async (tx) => {
        const p = schema.holdingPeriods;
        const values = {
          performanceAccountId: input.performanceAccountId,
          startDate: input.start,
          endDate: input.end,
          basis: "user" as const,
          notes: input.notes,
          updatedAt: new Date(),
        };
        let id = input.id;
        if (id === null) {
          const [row] = await tx
            .insert(p)
            .values(values)
            .returning({ id: p.id });
          id = row!.id;
        } else {
          const updated = await tx
            .update(p)
            .set(values)
            .where(and(eq(p.id, id), eq(p.basis, "user")))
            .returning({ id: p.id });
          if (updated.length === 0)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "That period no longer exists",
            });
          await tx
            .delete(schema.holdingPeriodWeights)
            .where(eq(schema.holdingPeriodWeights.holdingPeriodId, id));
        }
        await tx.insert(schema.holdingPeriodWeights).values(
          input.weights.map((w) => ({
            holdingPeriodId: id!,
            securityId: w.securityId,
            weight: w.weight.toFixed(6),
          })),
        );
        return { id };
      });
    }),

  deleteHoldingPeriod: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.holdingPeriods)
        .where(eq(schema.holdingPeriods.id, input.id));
      return { success: true };
    }),

  /**
   * A fund by its public ticker: checked against SEC's fund ticker list
   * (no guessing — an unknown ticker is refused), reusing a row that
   * already has it, then its facts fetched.
   */
  addFundByTicker: portfolioProcedure
    .input(
      z.object({
        ticker: z
          .string()
          .trim()
          .min(1)
          .max(12)
          .transform((t) => t.toUpperCase()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      const T = input.ticker;
      const [known] = await ctx.db
        .select({ id: s.id })
        .from(s)
        .where(eq(s.ticker, T));
      if (known) return { id: known.id };
      const [untickered] = await ctx.db
        .select({ id: s.id })
        .from(s)
        .where(and(isNull(s.ticker), sql`upper(${s.sourceSymbol}) = ${T}`));
      if (untickered) return { id: untickered.id };

      const contact = await getSecContact(ctx.db);
      if (!contact)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Set up SEC fund facts in Settings → Integrations to add funds by ticker, or add it by name",
        });
      const tickers = await fetchFundTickers(contact);
      if (!tickers.has(T))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SEC doesn't list a fund with the ticker ${T}`,
        });
      await ctx.db
        .insert(s)
        .values({
          ticker: T,
          sourceSymbol: T,
          name: T,
          kind: inferSecurityKind(T, ""),
          institution: null,
          sourceDescription: T,
        })
        .onConflictDoNothing();
      const [row] = await ctx.db
        .select({ id: s.id })
        .from(s)
        .where(eq(s.ticker, T));
      await syncSecurityFacts(ctx.db, { securityIds: [row!.id] });
      return { id: row!.id };
    }),

  /**
   * A fund with no public ticker (a workplace plan's own fund), by name.
   * Its fee and mix are entered by hand (setUserFacts).
   */
  addFundByName: portfolioProcedure
    .input(z.object({ name: z.string().trim().min(2).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      const [existing] = await ctx.db
        .select({ id: s.id })
        .from(s)
        .where(
          and(
            isNull(s.ticker),
            sql`lower(${s.name}) = ${input.name.toLowerCase()}`,
          ),
        );
      if (existing) return { id: existing.id };
      const [row] = await ctx.db
        .insert(s)
        .values({
          name: input.name,
          kind: "plan_fund",
          institution: null,
          sourceDescription: input.name,
        })
        .returning({ id: s.id });
      return { id: row!.id };
    }),
});
