import { assertWithinIrsLimits } from "@/server/services/contributions/caps";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { budgetAmountsSchema } from "@/lib/db/json-schemas";
import { applyContributionAccountEdit } from "@/server/services/contributions/account-edits";
import { applyContributionAccountEditsBatch } from "@/server/services/contributions/account-edits";
import type { DbOrTx } from "@/lib/db";
import {
  payProfileSelectionSchema,
  type PayProfileSelection,
} from "@/lib/pure/household/profile-selection.schema";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { firstRow } from "@/lib/utils/first-row";

/**
 * Which Contribution Profile a budget-linked item edit writes into — the
 * one the page shows. Throws rather than silently writing nowhere:
 * contributionValue/Method have no account-level fallback (see
 * applyContribActiveFields), so an edit with no profile has nowhere
 * correct to go.
 */
async function resolveEffectiveContribProfileIdForItem(
  db: DbOrTx,
  selection: PayProfileSelection | undefined,
): Promise<number> {
  const { contribProfileId: resolvedId } = await resolveProfileSelection(
    { db },
    selection,
  );
  if (resolvedId == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "No Contribution Profile is resolvable for this edit — activate a Contribution Profile before editing a linked amount",
    });
  }
  return resolvedId;
}

export const itemAmountProcedures = {
  /** Update a single amount cell for a budget item. */
  updateItemAmount: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        colIndex: z.number().int(),
        amount: z.number(),
        selection: payProfileSelectionSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id))
        .then(firstRow);
      if (!item)
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      // Linked items: the amount IS the budget amount from the user's
      // perspective, so budgetProcedure is intentionally allowed to write
      // through to the linked contribution account rather than the dead
      // budget_items.amounts field it would otherwise shadow. Writes into
      // whichever Contribution Profile is currently in effect for this
      // column — contributionValue/Method have no account-level fallback.
      if (item.contributionAccountId) {
        const accountId = item.contributionAccountId;
        // Read-resolve-write in one transaction (matches
        // patchProfileSubEntry's convention for the same class of
        // read-merge-write-a-JSON-blob operation) — a bare SELECT then
        // UPDATE with no transaction boundary at all, which this was
        // before, is strictly worse than that convention for no reason.
        await ctx.db.transaction(async (tx) => {
          const contribProfileId =
            await resolveEffectiveContribProfileIdForItem(tx, input.selection);
          await applyContributionAccountEdit(
            tx,
            accountId,
            input.amount,
            contribProfileId,
            assertWithinIrsLimits,
          );
        });
        return item;
      }

      const amounts = budgetAmountsSchema.parse(item.amounts);
      if (input.colIndex < 0 || input.colIndex >= amounts.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Column index out of bounds",
        });
      }
      amounts[input.colIndex] = input.amount;
      return ctx.db
        .update(schema.budgetItems)
        .set({ amounts })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then(firstRow);
    }),

  /** Batch update multiple amount cells. */
  updateItemAmounts: budgetProcedure
    .input(
      z.object({
        updates: z.array(
          z.object({
            id: z.number().int(),
            colIndex: z.number().int(),
            amount: z.number(),
          }),
        ),
        selection: payProfileSelectionSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const byId = new Map<number, { colIndex: number; amount: number }[]>();
      for (const u of input.updates) {
        const list = byId.get(u.id) ?? [];
        list.push({ colIndex: u.colIndex, amount: u.amount });
        byId.set(u.id, list);
      }
      if (byId.size === 0)
        return { ok: true, updated: 0, updatedItems: 0, skipped: [] };

      // One fetch, not one-per-item.
      const ids = Array.from(byId.keys());
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(inArray(schema.budgetItems.id, ids));
      const itemById = new Map(items.map((it) => [it.id, it]));

      // Sort the batch into "apply" and "skip". A since-deleted item or an
      // out-of-range colIndex (stale client whose column count no longer
      // matches the server) is skipped, not fatal — but it's now reported
      // back in `skipped` instead of vanishing silently, so a caller can
      // surface "3 of 50 cells couldn't be saved". A non-finite amount is a
      // client bug, not stale state — belt-and-braces since `z.number()`
      // in the input schema already rejects NaN and plain JSON can't carry
      // Infinity, but kept for any direct server-side caller.
      type SkipReason = "deleted" | "column-out-of-range";
      const skipped: { id: number; colIndex: number; reason: SkipReason }[] =
        [];
      const toApply: {
        id: number;
        amounts: number[];
        changes: { colIndex: number; amount: number }[];
      }[] = [];
      for (const [id, changes] of byId) {
        const item = itemById.get(id);
        if (!item) {
          for (const c of changes)
            skipped.push({ id, colIndex: c.colIndex, reason: "deleted" });
          continue;
        }
        // `amounts` tracks the profile's column count for linked items too
        // (add/removeColumn rewrite every item's array), so it's a valid
        // bound for both — a linked item that escapes this check would
        // otherwise write a real amount into the globally-active
        // Contribution Profile via the tier fallback, unreported.
        const amounts = budgetAmountsSchema.parse(item.amounts);
        const valid = changes.filter((c) => {
          if (!Number.isFinite(c.amount)) {
            // Message is user-facing (surfaced by the global
            // MutationCache.onError toast) — no raw ids.
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One of the pasted amounts isn't a valid number.",
            });
          }
          if (c.colIndex < 0 || c.colIndex >= amounts.length) {
            skipped.push({
              id,
              colIndex: c.colIndex,
              reason: "column-out-of-range",
            });
            return false;
          }
          return true;
        });
        if (valid.length > 0) toApply.push({ id, amounts, changes: valid });
      }
      // Deterministic lock-acquisition order (by id) so two concurrent
      // pastes touching an overlapping set of items can't deadlock.
      toApply.sort((a, b) => a.id - b.id);

      // Apply atomically — either the whole applicable paste lands or none
      // of it does (a mid-loop failure must not leave half a paste saved).
      await ctx.db.transaction(async (tx) => {
        // Linked items are collected instead of applied inline so
        // applyContributionAccountEditsBatch can fold every edit landing
        // on the SAME contribution profile through one read-merge-write,
        // instead of running that cycle once per account.
        const contributionEdits: {
          contributionAccountId: number;
          monthlyAmount: number;
          contributionProfileId: number;
        }[] = [];

        for (const { id, amounts, changes } of toApply) {
          const item = itemById.get(id)!;

          // Linked items: write through to the contribution account instead
          // of the dead budget_items.amounts field (see updateItemAmount for
          // the permission-scope rationale). If a batch carries more than
          // one distinct amount for the same linked item, last one wins.
          if (item.contributionAccountId) {
            const lastChange = changes[changes.length - 1]!;
            const contribProfileId =
              await resolveEffectiveContribProfileIdForItem(
                tx,
                input.selection,
              );
            contributionEdits.push({
              contributionAccountId: item.contributionAccountId,
              monthlyAmount: lastChange.amount,
              contributionProfileId: contribProfileId,
            });
            continue;
          }

          for (const c of changes) amounts[c.colIndex] = c.amount;
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, id));
        }

        await applyContributionAccountEditsBatch(
          tx,
          contributionEdits,
          assertWithinIrsLimits,
        );
      });
      const appliedCells = toApply.reduce((n, t) => n + t.changes.length, 0);
      return {
        ok: true,
        updated: appliedCells,
        updatedItems: toApply.length,
        skipped,
      };
    }),
};
