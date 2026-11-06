import { loadTrackedAccountNames } from "@/server/data/account-names";
import { eq, asc, sql, gte, lte, and } from "drizzle-orm";
import { z } from "zod/v4";
import { MS_PER_DAY } from "@/lib/constants";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { groupSnapshotAccounts } from "@/lib/pure/net-worth/snapshot-groups";
import { toNumber } from "@/lib/utils/numbers";

export const snapshotProcedures = {
  /** Paginated snapshot list with optional date range filter and sorting. */
  listSnapshots: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(1000).default(52),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        sortCol: z
          .enum(["date", "total", "accounts", "change", "changePct"])
          .optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, dateFrom, dateTo, sortCol, sortDir } = input;

      // Build WHERE conditions for date range
      const conditions = [];
      if (dateFrom) {
        conditions.push(gte(schema.portfolioSnapshots.snapshotDate, dateFrom));
      }
      if (dateTo) {
        conditions.push(lte(schema.portfolioSnapshots.snapshotDate, dateTo));
      }
      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // 1. Fetch ALL matching snapshots with totals (lightweight — for delta + sort)
      const allSnapsQuery = ctx.db
        .select({
          id: schema.portfolioSnapshots.id,
          snapshotDate: schema.portfolioSnapshots.snapshotDate,
          notes: schema.portfolioSnapshots.notes,
          total: sql<string>`coalesce(sum(${schema.portfolioAccounts.amount}), 0)`,
          accountCount: sql<number>`count(${schema.portfolioAccounts.id})`,
        })
        .from(schema.portfolioSnapshots)
        .leftJoin(
          schema.portfolioAccounts,
          eq(schema.portfolioSnapshots.id, schema.portfolioAccounts.snapshotId),
        )
        .groupBy(schema.portfolioSnapshots.id);
      const allSnaps = whereClause
        ? await allSnapsQuery.where(whereClause)
        : await allSnapsQuery;

      const totalCount = allSnaps.length;
      if (totalCount === 0) {
        return {
          snapshots: [],
          totalCount: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

      // 2. Compute delta and deltaPct across the full sorted-by-date dataset
      const byDate = [...allSnaps].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate),
      );
      const deltaMap = new Map<
        number,
        {
          delta: number | null;
          deltaPct: number | null;
          daysSincePrev: number | null;
        }
      >();
      for (let i = 0; i < byDate.length; i++) {
        const curr = toNumber(byDate[i]!.total);
        const prev = i > 0 ? toNumber(byDate[i - 1]!.total) : null;
        const delta = prev != null ? curr - prev : null;
        const deltaPct =
          prev != null && prev > 0 ? ((curr - prev) / prev) * 100 : null;
        const daysSincePrev =
          i > 0
            ? Math.round(
                (new Date(byDate[i]!.snapshotDate).getTime() -
                  new Date(byDate[i - 1]!.snapshotDate).getTime()) /
                  MS_PER_DAY,
              )
            : null;
        deltaMap.set(byDate[i]!.id, { delta, deltaPct, daysSincePrev });
      }

      // 3. Build sortable items and sort by requested column
      type SnapItem = (typeof allSnaps)[number] & {
        totalNum: number;
        delta: number | null;
        deltaPct: number | null;
        daysSincePrev: number | null;
      };
      const sortable: SnapItem[] = allSnaps.map((s) => ({
        ...s,
        totalNum: toNumber(s.total),
        ...(deltaMap.get(s.id) ?? {
          delta: null,
          deltaPct: null,
          daysSincePrev: null,
        }),
      }));

      const dir = sortDir === "asc" ? 1 : -1;
      if (sortCol) {
        sortable.sort((a, b) => {
          let cmp = 0;
          switch (sortCol) {
            case "date":
              cmp = a.snapshotDate.localeCompare(b.snapshotDate);
              break;
            case "total":
              cmp = a.totalNum - b.totalNum;
              break;
            case "accounts":
              cmp = Number(a.accountCount) - Number(b.accountCount);
              break;
            case "change":
              cmp = (a.delta ?? 0) - (b.delta ?? 0);
              break;
            case "changePct":
              cmp = (a.deltaPct ?? 0) - (b.deltaPct ?? 0);
              break;
          }
          return cmp * dir;
        });
      } else {
        // Default: newest first
        sortable.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
      }

      // 4. Paginate
      const offset = (page - 1) * pageSize;
      const pageSnaps = sortable.slice(offset, offset + pageSize);
      if (pageSnaps.length === 0) {
        return {
          snapshots: [],
          totalCount,
          page,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize),
        };
      }

      // 5. Batch-load detailed accounts only for the page
      const snapshotIds = pageSnaps.map((s) => s.id);
      const allAccounts = await ctx.db
        .select({
          id: schema.portfolioAccounts.id,
          snapshotId: schema.portfolioAccounts.snapshotId,
          institution: schema.portfolioAccounts.institution,
          taxType: schema.portfolioAccounts.taxType,
          accountType: schema.portfolioAccounts.accountType,
          subType: schema.portfolioAccounts.subType,
          label: schema.portfolioAccounts.label,
          amount: schema.portfolioAccounts.amount,
          ownerPersonId: schema.portfolioAccounts.ownerPersonId,
          performanceAccountId: schema.portfolioAccounts.performanceAccountId,
          ownerName: schema.people.name,
          perfAccountLabel: schema.performanceAccounts.accountLabel,
          perfDisplayName: schema.performanceAccounts.displayName,
          perfAccountType: schema.performanceAccounts.accountType,
          perfOwnerPersonId: schema.performanceAccounts.ownerPersonId,
        })
        .from(schema.portfolioAccounts)
        .leftJoin(
          schema.performanceAccounts,
          eq(
            schema.portfolioAccounts.performanceAccountId,
            schema.performanceAccounts.id,
          ),
        )
        .leftJoin(
          schema.people,
          eq(schema.portfolioAccounts.ownerPersonId, schema.people.id),
        )
        .where(
          sql`${schema.portfolioAccounts.snapshotId} IN (${sql.join(
            snapshotIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        // Stable insertion order — without it the row order is the DB's
        // physical scan order, which shifts after an inline balance edit
        // (the updated tuple's new version lands elsewhere in a Postgres
        // seq scan), so the expanded snapshot's sub-rows visibly reshuffle
        // mid-edit.
        .orderBy(asc(schema.portfolioAccounts.id));

      const accountsBySnapshot = groupSnapshotAccounts(allAccounts);

      const items = pageSnaps.map((s) => {
        const accounts = accountsBySnapshot.get(s.id) ?? [];
        return {
          id: s.id,
          snapshotDate: s.snapshotDate,
          notes: s.notes,
          total: s.totalNum,
          accountCount: Number(s.accountCount),
          delta: s.delta,
          deltaPct: s.deltaPct,
          daysSincePrev: s.daysSincePrev,
          accounts: accounts.map((a) => ({
            id: a.id,
            institution: a.institution,
            taxType: a.taxType,
            accountType: a.accountType,
            subType: a.subType,
            label: a.label,
            amount: toNumber(a.amount),
            ownerPersonId: a.ownerPersonId,
            ownerName: a.ownerName,
            performanceAccountId: a.performanceAccountId,
            perfAccountLabel: a.perfAccountLabel,
            perfDisplayName: a.perfDisplayName,
            perfAccountType: a.perfAccountType,
            perfOwnerPersonId: a.perfOwnerPersonId,
          })),
        };
      });

      return {
        snapshots: items,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    }),

  /**
   * Lightweight snapshot totals for the portfolio chart — (date, total)
   * pairs, plus each snapshot's amount per tracked account (for the
   * stacked by-account view; rows tied to no account are "Other").
   */
  listSnapshotTotals: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        snapshotDate: schema.portfolioSnapshots.snapshotDate,
        snapshotId: schema.portfolioSnapshots.id,
      })
      .from(schema.portfolioSnapshots)
      .orderBy(asc(schema.portfolioSnapshots.snapshotDate));

    if (rows.length === 0) return [];

    // Batch sum accounts per snapshot
    const totals = await ctx.db
      .select({
        snapshotId: schema.portfolioAccounts.snapshotId,
        total: sql<string>`sum(${schema.portfolioAccounts.amount})`,
      })
      .from(schema.portfolioAccounts)
      .groupBy(schema.portfolioAccounts.snapshotId);

    const totalMap = new Map(
      totals.map((t) => [t.snapshotId, toNumber(t.total)]),
    );
    const [perAccount, names] = await Promise.all([
      ctx.db
        .select({
          snapshotId: schema.portfolioAccounts.snapshotId,
          performanceAccountId: schema.portfolioAccounts.performanceAccountId,
          amount: sql<string>`sum(${schema.portfolioAccounts.amount})`,
        })
        .from(schema.portfolioAccounts)
        .groupBy(
          schema.portfolioAccounts.snapshotId,
          schema.portfolioAccounts.performanceAccountId,
        ),
      loadTrackedAccountNames(ctx.db),
    ]);
    const bySnapshot = new Map<
      number,
      { key: string; label: string; amount: number }[]
    >();
    for (const r of perAccount) {
      const list = bySnapshot.get(r.snapshotId) ?? [];
      const id = r.performanceAccountId;
      list.push({
        key: id === null ? "other" : String(id),
        label: (id !== null && names.get(id)) || "Other",
        amount: toNumber(r.amount),
      });
      bySnapshot.set(r.snapshotId, list);
    }

    return rows.map((r) => ({
      id: r.snapshotId,
      date: r.snapshotDate,
      total: totalMap.get(r.snapshotId) ?? 0,
      byAccount: bySnapshot.get(r.snapshotId) ?? [],
    }));
  }),
};
