import { eq, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { roundToCents, safeDivide, toDecimalColumn } from "@/lib/utils/math";
import {
  refreshSnapshotYearDerivatives,
  pushSnapshotIfConfigured,
} from "@/server/services/net-worth/snapshot-derivatives";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import {
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "@/lib/config/enum-values";
import {
  buildPrevInactiveKeys,
  resolveAccountActiveStatus,
  resolveSnapshotParentCategory,
  resolveSnapshotAccountAmounts,
} from "@/lib/pure/accounts/portfolio";

const portfolioSnapshotInput = z.object({
  snapshotDate: zCalendarDate,
  notes: z.string().nullable().optional(),
  accounts: z.array(
    z.object({
      institution: z.string().trim().min(1),
      taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
      accountType: z.enum(accountCategoryEnum()),
      subType: z.string().nullable().optional(),
      label: z.string().trim().nullable().optional(),
      parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
      amount: zDecimal,
      ownerPersonId: z.number().int().nullable(),
      performanceAccountId: z.number().int().nullable().optional(),
    }),
  ),
});

export const portfolioSnapshotProcedures = {
  /** Get the latest snapshot with its accounts (for pre-filling a new snapshot form). */
  getLatest: protectedProcedure.query(async ({ ctx }) => {
    const snapshots = await ctx.db
      .select()
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const latest = snapshots[0];
    if (!latest) return null;
    const accounts = await ctx.db
      .select()
      .from(schema.portfolioAccounts)
      .where(eq(schema.portfolioAccounts.snapshotId, latest.id));
    return { snapshot: latest, accounts };
  }),

  /** Create a new snapshot with all its accounts in a single call. */
  create: portfolioProcedure
    .input(portfolioSnapshotInput)
    .mutation(async ({ ctx, input }) => {
      // Friendly pre-check for the `snapshot_date` unique constraint —
      // the catch below is the authoritative backstop against a race.
      const existingForDate = await ctx.db
        .select({ id: schema.portfolioSnapshots.id })
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.snapshotDate, input.snapshotDate))
        .limit(1);
      if (existingForDate.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A snapshot already exists for ${input.snapshotDate}. Edit that one, or pick another date.`,
        });
      }

      // Wrap all DB mutations in a transaction for atomicity.
      // Budget API push happens after (external side effect, not rollback-able).
      const snapshot = await ctx.db
        .transaction(async (tx) => {
          const rows = await tx
            .insert(schema.portfolioSnapshots)
            .values({
              snapshotDate: input.snapshotDate,
              notes: input.notes ?? null,
            })
            .returning();
          const snap = rows[0]!;

          // perfId → parentCategory (synced from the master) and the set of open
          // masters, resolved once for both the account insert and the ending
          // balances, so the snapshot has one view of its accounts.
          const perfIds = input.accounts
            .map((a) => a.performanceAccountId)
            .filter((id): id is number => id != null);
          const perfCatMap = new Map<number, string>();
          const activeMasterIds = new Set<number>();
          if (perfIds.length > 0) {
            const perfRows = await tx
              .select({
                id: schema.performanceAccounts.id,
                parentCategory: schema.performanceAccounts.parentCategory,
                isActive: schema.performanceAccounts.isActive,
              })
              .from(schema.performanceAccounts)
              .where(inArray(schema.performanceAccounts.id, perfIds));
            for (const p of perfRows) {
              perfCatMap.set(p.id, p.parentCategory);
              if (p.isActive) activeMasterIds.add(p.id);
            }
          }
          // A closed master's account keeps its row with a zeroed balance (see
          // resolveSnapshotAccountAmounts: omitting it breaks period conservation).
          const resolvedAccounts = resolveSnapshotAccountAmounts(
            input.accounts,
            activeMasterIds,
          );

          if (resolvedAccounts.length > 0) {
            // Carry forward isActive from previous snapshot's matching accounts
            const prevSnapshots = await tx
              .select({ id: schema.portfolioSnapshots.id })
              .from(schema.portfolioSnapshots)
              .where(sql`${schema.portfolioSnapshots.id} != ${snap.id}`)
              .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
              .limit(1);
            let prevInactiveKeys = new Set<string>();
            if (prevSnapshots.length > 0) {
              const prevAccounts = await tx
                .select({
                  performanceAccountId:
                    schema.portfolioAccounts.performanceAccountId,
                  taxType: schema.portfolioAccounts.taxType,
                  subType: schema.portfolioAccounts.subType,
                  ownerPersonId: schema.portfolioAccounts.ownerPersonId,
                  isActive: schema.portfolioAccounts.isActive,
                })
                .from(schema.portfolioAccounts)
                .where(
                  eq(schema.portfolioAccounts.snapshotId, prevSnapshots[0]!.id),
                );
              prevInactiveKeys = buildPrevInactiveKeys(prevAccounts);
            }

            await tx.insert(schema.portfolioAccounts).values(
              resolvedAccounts.map((a) => ({
                snapshotId: snap.id,
                institution: a.institution,
                taxType: a.taxType,
                accountType: a.accountType,
                subType: a.subType ?? null,
                label: a.label ?? null,
                parentCategory: resolveSnapshotParentCategory(
                  a.parentCategory,
                  a.performanceAccountId ?? null,
                  perfCatMap,
                ),
                amount: a.amount,
                ownerPersonId: a.ownerPersonId,
                performanceAccountId: a.performanceAccountId ?? null,
                isActive: resolveAccountActiveStatus(
                  {
                    performanceAccountId: a.performanceAccountId ?? null,
                    taxType: a.taxType,
                    subType: a.subType ?? null,
                    ownerPersonId: a.ownerPersonId ?? null,
                  },
                  prevInactiveKeys,
                ),
              })),
            );
          }

          // Ending balances + annual rollups for the snapshot's year, shared with
          // the latest-snapshot balance edit (RULES §Single Computation Path), from
          // the same `resolvedAccounts` as the insert.
          await refreshSnapshotYearDerivatives(
            tx,
            input.snapshotDate,
            resolvedAccounts.map((a) => ({
              performanceAccountId: a.performanceAccountId ?? null,
              amount: a.amount,
            })),
          );

          return snap;
        })
        .catch((e: unknown) => {
          // Race backstop for the `snapshot_date` unique constraint —
          // the pre-check above catches the common case.
          const code =
            e && typeof e === "object" && "code" in e
              ? (e as { code?: string }).code
              : undefined;
          const msg = e instanceof Error ? e.message : "";
          if (code === "23505" || /UNIQUE constraint failed/i.test(msg)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `A snapshot already exists for ${input.snapshotDate}. Edit that one, or pick another date.`,
            });
          }
          throw e;
        });

      // Auto-pull portfolio balances from budget API for linked accounts (before push)
      let apiPullResult: { pulled: number; error?: string } = { pulled: 0 };
      try {
        const {
          getActiveBudgetApi: getActiveForPull,
          getApiConnection: getConnForPull,
        } = await import("@/lib/budget-api");
        const { getApiAccountBalanceMap: getMapForPull } =
          await import("@/server/services/sync/api-balance-resolution");
        const activeForPull = await getActiveForPull(ctx.db);
        if (activeForPull !== "none") {
          const connForPull = await getConnForPull(ctx.db, activeForPull);
          const pullMappings = (connForPull?.accountMappings ?? []).filter(
            (m: { syncDirection: string; performanceAccountId?: number }) =>
              m.performanceAccountId != null &&
              (m.syncDirection === "pull" || m.syncDirection === "both"),
          );
          if (pullMappings.length > 0) {
            const pullBalanceMap = await getMapForPull(ctx.db, activeForPull);
            if (pullBalanceMap) {
              // Pulled amounts and the year's derivatives are refreshed together in one
              // transaction, so Performance and Net Worth agree about this save.
              const pulled = await ctx.db.transaction(async (tx) => {
                const pullSnapshotAccounts = await tx
                  .select()
                  .from(schema.portfolioAccounts)
                  .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id));
                let pulled = 0;
                for (const mapping of pullMappings) {
                  const m = mapping as {
                    remoteAccountId: string;
                    performanceAccountId?: number;
                  };
                  const apiBalance = pullBalanceMap.get(m.remoteAccountId);
                  // The cache may hold no number where a figure was missing.
                  if (typeof apiBalance !== "number" || !m.performanceAccountId)
                    continue;
                  const matchingRows = pullSnapshotAccounts.filter(
                    (a) => a.performanceAccountId === m.performanceAccountId,
                  );
                  if (matchingRows.length === 0) continue;
                  const currentTotal = matchingRows.reduce(
                    (s, a) => s + Number(a.amount),
                    0,
                  );
                  if (matchingRows.length === 1) {
                    await tx
                      .update(schema.portfolioAccounts)
                      .set({
                        amount: toDecimalColumn(
                          apiBalance,
                          "a balance from the budget app",
                        ),
                      })
                      .where(
                        eq(schema.portfolioAccounts.id, matchingRows[0]!.id),
                      );
                  } else {
                    const ratio = safeDivide(apiBalance, currentTotal, 0);
                    for (const row of matchingRows) {
                      const scaled = Number(row.amount) * ratio;
                      await tx
                        .update(schema.portfolioAccounts)
                        .set({
                          amount: toDecimalColumn(
                            roundToCents(scaled),
                            "a balance from the budget app",
                          ),
                        })
                        .where(eq(schema.portfolioAccounts.id, row.id));
                    }
                  }
                  pulled++;
                }
                if (pulled > 0) {
                  const finalRows = await tx
                    .select()
                    .from(schema.portfolioAccounts)
                    .where(
                      eq(schema.portfolioAccounts.snapshotId, snapshot.id),
                    );
                  await refreshSnapshotYearDerivatives(
                    tx,
                    input.snapshotDate,
                    finalRows.map((r) => ({
                      performanceAccountId: r.performanceAccountId ?? null,
                      amount: r.amount,
                    })),
                  );
                }
                return pulled;
              });
              apiPullResult = { pulled };
            }
          }
        }
      } catch (e) {
        apiPullResult = {
          pulled: 0,
          error: e instanceof Error ? e.message : "Unknown error",
        };
      }

      // Auto-push to budget API tracking accounts if configured — same
      // helper the latest-snapshot balance edit uses (mode differs there).
      const apiSyncResult = await pushSnapshotIfConfigured(ctx.db, {
        snapshotId: snapshot.id,
        snapshotDate: input.snapshotDate,
        mode: "create",
        asOfDate: new Date(), // after the fetch
      });

      return { ...snapshot, apiSyncResult, apiPullResult };
    }),

  /** Delete a snapshot (cascades to its accounts). */
  delete: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .delete(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.id, input.id)),
    ),
};
