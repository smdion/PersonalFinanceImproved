import { z } from "zod/v4";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { adminProcedure, protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { recomputeTodaySnapshotFromLocal } from "@/lib/simplefin/sync";
import { redactStoredCardSpending } from "@/lib/simplefin/ingest";
import { loadLatestSubAccounts } from "@/server/data/sub-accounts";
import {
  applyLoanFeedBalances,
  clearLoanBalance,
  loansFedBySimplefin,
} from "@/server/services/sync/loan-feed";
import { accountDisplayName } from "@/lib/utils/format";
import { TRPCError } from "@trpc/server";
import { loadLinkContext } from "@/server/services/sync/simplefin";
import {
  latestSyncAt,
  mergeRefusal,
  readdedCandidates,
} from "@/lib/pure/sync/simplefin-reidentify";
import { loadFeedIdentities, mergeCopyInto } from "@/lib/simplefin/reidentify";

const MERGE_REFUSED = {
  same_row: "An account can't be merged into itself",
  other_institution: "Both accounts must be at the same institution",
  copy_linked: "Unlink the new account before merging it",
  copy_excluded: "Include the new account before merging it",
  copy_not_reported: "The new account didn't answer the latest sync",
  kept_still_reported: "That account still answered the latest sync",
  reported_together:
    "Both accounts have history from the same time: they're two accounts",
  not_a_debt: "A loan's feed can only take an account that owes money",
} as const;

export const linksProcedures = {
  /** New unlinked accounts that look like a re-added institution's copy of
   *  an account absent from the latest sync (readdedCandidates). */
  listReaddedAccounts: protectedProcedure.query(async ({ ctx }) =>
    readdedCandidates(await loadFeedIdentities(ctx.db)),
  ),

  /** Merge a new copy into the account it duplicates, as the owner
   *  confirmed: no 24-hour wait. */
  mergeReaddedAccount: adminProcedure
    .input(z.object({ copyId: z.number().int(), keepId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const rows = await loadFeedIdentities(tx);
        const copy = rows.find((r) => r.id === input.copyId);
        const keep = rows.find((r) => r.id === input.keepId);
        if (!copy || !keep)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "SimpleFIN account not found",
          });
        const refusal = mergeRefusal(copy, keep, latestSyncAt(rows));
        if (refusal)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: MERGE_REFUSED[refusal],
          });
        await mergeCopyInto(tx, keep.id, copy.id, "owner");
        await applyLoanFeedBalances(tx, new Set([copy.externalAccountId]));
      });
      await redactStoredCardSpending(ctx.db, input.keepId);
      return {
        ok: true as const,
        ...(await recomputeTodaySnapshotFromLocal(ctx.db, ctx.scope.asOf)),
      };
    }),

  /** Active performance_accounts, for the match-to-existing-account picker. */
  listMatchableAccounts: protectedProcedure.query(async ({ ctx }) => {
    const [accounts, people, subs] = await Promise.all([
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.isActive, true))
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
      ctx.db.select().from(schema.people),
      loadLatestSubAccounts(ctx.db),
    ]);
    const peopleMap = new Map(people.map((p) => [p.id, p.name]));
    return accounts.map((a) => ({
      id: a.id,
      label: accountDisplayName(
        a,
        a.ownerPersonId != null ? peopleMap.get(a.ownerPersonId) : undefined,
      ),
      // Only worth choosing between when the account has more than one.
      subAccounts: subs
        .filter((sub) => sub.performanceAccountId === a.id)
        .map((sub) => ({ key: sub.key, label: sub.label })),
    }));
  }),

  /**
   * Link every unlinked SimpleFIN account to its suggested (sub-)account, and
   * narrow whole-account links to their suggested sub-account.
   */
  acceptLinkSuggestions: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(schema.simplefinAccounts);
      const { suggestions } = await loadLinkContext(ctx.db, rows);
      let linked = 0;
      for (const [id, s] of suggestions) {
        if (input.ids && !input.ids.includes(id)) continue;
        const updated = await ctx.db
          .update(schema.simplefinAccounts)
          .set({
            linkedPerformanceAccountId: s.performanceAccountId,
            linkedSubKey: s.subKey,
          })
          .where(
            and(
              eq(schema.simplefinAccounts.id, id),
              isNull(schema.simplefinAccounts.linkedLoanId),
              // Unlinked, or linked to this whole account (a narrower link).
              or(
                isNull(schema.simplefinAccounts.linkedPerformanceAccountId),
                and(
                  eq(
                    schema.simplefinAccounts.linkedPerformanceAccountId,
                    s.performanceAccountId,
                  ),
                  isNull(schema.simplefinAccounts.linkedSubKey),
                ),
              ),
            ),
          )
          .returning({ id: schema.simplefinAccounts.id });
        // Linked meanwhile (another tab, a sync): nothing changed here.
        if (updated.length === 0) continue;
        await redactStoredCardSpending(ctx.db, id);
        linked++;
      }
      return { linked };
    }),

  /**
   * Match (or unmatch) a SimpleFIN account to an existing performance_accounts
   * row, so listAccounts can show live-vs-snapshot drift. Many-to-one:
   * multiple SimpleFIN accounts can point at the same performance account
   * (e.g. historical account splits/merges Ledgr still tracks as a single
   * account) — listAccounts sums every linked account's balance before
   * comparing against the snapshot, so this intentionally does NOT unlink
   * any other account pointed at the same target.
   */
  setAccountMapping: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        performanceAccountId: z.number().int().nullable(),
        /** A sub-account of that tracked account (snapshotAccountKey), or null/absent for the whole account. */
        subKey: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subKey =
        input.performanceAccountId == null ? null : (input.subKey ?? null);
      if (subKey) {
        const subs = await loadLatestSubAccounts(ctx.db);
        if (
          !subs.some(
            (sub) =>
              sub.key === subKey &&
              sub.performanceAccountId === input.performanceAccountId,
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That sub-account isn't in the latest snapshot",
          });
      }
      if (input.performanceAccountId != null) {
        const [target] = await ctx.db
          .select({ id: schema.performanceAccounts.id })
          .from(schema.performanceAccounts)
          .where(
            and(
              eq(schema.performanceAccounts.id, input.performanceAccountId),
              eq(schema.performanceAccounts.isActive, true),
            ),
          )
          .limit(1);
        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Performance account not found or inactive",
          });
        }
      }

      // A feed is an account or a loan: linking one ends the other.
      const [before] = await ctx.db
        .select({ linkedLoanId: schema.simplefinAccounts.linkedLoanId })
        .from(schema.simplefinAccounts)
        .where(eq(schema.simplefinAccounts.id, input.id));
      const endsLoanLink =
        input.performanceAccountId != null && before?.linkedLoanId != null;
      const [row] = await ctx.db
        .update(schema.simplefinAccounts)
        .set({
          linkedPerformanceAccountId: input.performanceAccountId,
          linkedSubKey: subKey,
          ...(endsLoanLink ? { linkedLoanId: null } : {}),
        })
        .where(eq(schema.simplefinAccounts.id, input.id))
        .returning();
      if (endsLoanLink) {
        await clearLoanBalance(ctx.db, before!.linkedLoanId!);
        await recomputeTodaySnapshotFromLocal(ctx.db, ctx.scope.asOf);
      }

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SimpleFIN account not found",
        });
      }

      // Relinking to an HSA (or unlinking) redacts card spending kept while
      // the account was linked elsewhere — same rule as ingest.
      await redactStoredCardSpending(ctx.db, row.id);

      return {
        ok: true as const,
        linkedPerformanceAccountId: row.linkedPerformanceAccountId,
      };
    }),

  /** Loans a feed can report; `feedId` shows which are taken. */
  listLinkableLoans: protectedProcedure.query(async ({ ctx }) => {
    const [loans, feeds] = await Promise.all([
      ctx.db
        .select({
          id: schema.mortgageLoans.id,
          name: schema.mortgageLoans.name,
        })
        .from(schema.mortgageLoans)
        .where(eq(schema.mortgageLoans.isActive, true)),
      loansFedBySimplefin(ctx.db),
    ]);
    return loans.map((l) => ({ ...l, fedBySimplefin: feeds.has(l.id) }));
  }),

  /**
   * Make a feed a mortgage's balance (or stop, with loanId null). The feed
   * stops being an account: it leaves any tracked-account link and the live
   * total, and it's included, or the link would do nothing.
   */
  setLoanLink: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        loanId: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [feed] = await ctx.db
        .select()
        .from(schema.simplefinAccounts)
        .where(eq(schema.simplefinAccounts.id, input.id));
      if (!feed)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SimpleFIN account not found",
        });
      if (input.loanId != null) {
        const [loan] = await ctx.db
          .select({ id: schema.mortgageLoans.id })
          .from(schema.mortgageLoans)
          .where(eq(schema.mortgageLoans.id, input.loanId));
        if (!loan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That loan no longer exists",
          });
        const [taken] = await ctx.db
          .select({ id: schema.simplefinAccounts.id })
          .from(schema.simplefinAccounts)
          .where(eq(schema.simplefinAccounts.linkedLoanId, input.loanId));
        if (taken && taken.id !== feed.id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another SimpleFIN account already reports that loan",
          });
      }
      await ctx.db.transaction(async (tx) => {
        if (feed.linkedLoanId != null && feed.linkedLoanId !== input.loanId)
          await clearLoanBalance(tx, feed.linkedLoanId);
        await tx
          .update(schema.simplefinAccounts)
          .set(
            input.loanId != null
              ? {
                  linkedLoanId: input.loanId,
                  linkedPerformanceAccountId: null,
                  linkedSubKey: null,
                  isIncluded: true,
                }
              : { linkedLoanId: null },
          )
          .where(eq(schema.simplefinAccounts.id, feed.id));
        await applyLoanFeedBalances(tx);
      });
      await redactStoredCardSpending(ctx.db, feed.id);
      return {
        ok: true as const,
        ...(await recomputeTodaySnapshotFromLocal(ctx.db, ctx.scope.asOf)),
      };
    }),
};
