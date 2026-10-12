/** "You added / markets" split for the Live Balance card (portfolioProcedure — transaction-level detail). */
import { z } from "zod/v4";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { flowsSince } from "@/lib/pure/snapshot-flows";
import { getTransactionCoverageStart } from "@/lib/simplefin/sync";
import { REDACTED_MEDICAL_DESCRIPTION, utcDayOf } from "@/lib/simplefin/ingest";
import { INVESTMENT_TRANSACTION_KIND_LABELS } from "@/lib/config/display-labels";
import { countedFeed, loadClassifiedTransactions } from "./_shared";

/** Kinds worth showing as recent activity on the dashboard. */
const ACTIVITY_KINDS = new Set([
  "contribution",
  "withdrawal",
  "dividend",
  "interest",
  "fee",
]);

export const investmentSnapshotFlowsRouter = createTRPCRouter({
  /**
   * Money added since a snapshot across SimpleFIN accounts linked to tracked
   * accounts (the Live Balance change's scope), whether stored transactions
   * reach back that far, and the latest few money movements.
   */
  getSnapshotFlows: portfolioProcedure
    .input(z.object({ since: z.iso.date() }))
    .query(async ({ ctx, input }) => {
      const [linked, coverageStart, rows] = await Promise.all([
        ctx.db
          .select({ id: schema.simplefinAccounts.id })
          .from(schema.simplefinAccounts)
          .where(countedFeed),
        getTransactionCoverageStart(ctx.db),
        loadClassifiedTransactions(ctx.db, { since: input.since }),
      ]);
      const linkedIds = new Set(linked.map((l) => l.id));
      const covered =
        coverageStart !== null && utcDayOf(coverageStart) <= input.since;
      const { added, uncertainCount } = flowsSince(
        rows.filter((r) => linkedIds.has(r.simplefinAccountId)),
        input.since,
      );
      const recent = rows
        .filter((r) => !r.pending && ACTIVITY_KINDS.has(r.kind))
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          posted: r.posted,
          institution: r.institution,
          // A clean label, not the raw description (fund names, codes);
          // redacted HSA spending keeps its "Medical withdrawal" wording.
          label:
            r.description === REDACTED_MEDICAL_DESCRIPTION
              ? r.description
              : INVESTMENT_TRANSACTION_KIND_LABELS[r.kind],
          amount: r.amount,
        }));
      return { covered, added, uncertainCount, recent };
    }),
});
