import { currentLoan } from "@/server/services/projection/engine-payload/expense-endings";
import {
  SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
  SK_RETIREMENT_DECUMULATION_EXPENSE_OVERRIDE,
} from "@/lib/constants/settings-keys";
import { eq, asc, inArray, and } from "drizzle-orm";
import { z } from "zod/v4";
import { protectedProcedure, budgetProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getActiveBudgetProfile } from "@/server/data/budget-profiles";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import { TAX_TREATMENT_LABELS } from "@/lib/config/display-labels";

export const itemLinkProcedures = {
  // ── Contribution Account Linking ──

  /** The budget lines that could be a loan's payment, on the active budget
   *  profile, and which one is. */
  listMortgageItemChoices: protectedProcedure
    .input(z.object({ loanId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [active, settings, loans, profiles, items] = await Promise.all([
        getActiveBudgetProfile(ctx.db),
        ctx.db.select().from(schema.appSettings),
        ctx.db.select().from(schema.mortgageLoans),
        ctx.db.select().from(schema.budgetProfiles),
        ctx.db
          .select()
          .from(schema.budgetItems)
          .orderBy(asc(schema.budgetItems.sortOrder)),
      ]);
      const setting = (key: string) =>
        settings.find((s) => s.key === key)?.value ?? null;
      // The working budget and the retirement budget can be different
      // profiles; a line is linked per profile.
      const retirementId = Number(
        setting(SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID),
      );
      const shown = profiles.filter(
        (p) => p.id === active?.id || p.id === retirementId,
      );
      return {
        retirementTyped: !!setting(SK_RETIREMENT_DECUMULATION_EXPENSE_OVERRIDE),
        budgets: shown.map((p) => {
          const own = items.filter((i) => i.profileId === p.id);
          return {
            budgetProfileId: p.id,
            name: p.name,
            items: own.map((i) => ({ id: i.id, name: i.subcategory })),
            // A link made before a refinance still means this loan.
            linkedItemId:
              own.find(
                (i) =>
                  i.mortgageLoanId !== null &&
                  currentLoan(loans, i.mortgageLoanId)?.id === input.loanId,
              )?.id ?? null,
          };
        }),
      };
    }),

  /** Mark which line of a budget pays a loan (null clears it). A line pays
   *  one loan and a loan has one line per profile: the projection drops it
   *  after payoff. */
  setMortgageItem: budgetProcedure
    .input(
      z.object({
        budgetProfileId: z.number().int(),
        loanId: z.number().int(),
        itemId: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const loans = await tx.select().from(schema.mortgageLoans);
        const stale = loans
          .filter((l) => currentLoan(loans, l.id)?.id === input.loanId)
          .map((l) => l.id);
        await tx
          .update(schema.budgetItems)
          .set({ mortgageLoanId: null })
          .where(
            and(
              eq(schema.budgetItems.profileId, input.budgetProfileId),
              inArray(schema.budgetItems.mortgageLoanId, stale),
            ),
          );
        if (input.itemId !== null) {
          await tx
            .update(schema.budgetItems)
            .set({ mortgageLoanId: input.loanId })
            .where(
              and(
                eq(schema.budgetItems.id, input.itemId),
                eq(schema.budgetItems.profileId, input.budgetProfileId),
              ),
            );
        }
      });
      return { ok: true };
    }),

  /** Link a budget item to a specific contribution account. */
  linkContributionAccount: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        contributionAccountId: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ contributionAccountId: input.contributionAccountId })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Remove contribution account link from a budget item. */
  unlinkContributionAccount: budgetProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ contributionAccountId: null })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** List non-payroll contribution accounts for the linking UI.
   *  jobId === null means the contribution comes from take-home pay (IRA,
   *  taxable brokerage, etc.). Job-linked contributions (401k, HSA, ESPP)
   *  are payroll-deducted and already on the paycheck. */
  listContribAccountsForLinking: protectedProcedure.query(async ({ ctx }) => {
    const [contribs, people, perfAccounts] = await Promise.all([
      ctx.db
        .select()
        .from(schema.contributionAccounts)
        .where(eq(schema.contributionAccounts.isActive, true)),
      ctx.db.select().from(schema.people),
      ctx.db.select().from(schema.performanceAccounts),
    ]);

    const personMap = new Map(people.map((p) => [p.id, p.name]));
    const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

    // Non-payroll = no job link — these come from take-home pay
    const filtered = contribs.filter((c) => c.jobId === null);

    return filtered.map((c) => {
      const perf = c.performanceAccountId
        ? perfMap.get(c.performanceAccountId)
        : null;
      // This account's own ownership (individual + personId) must win over
      // the linked performance account's own ownershipType — a shared,
      // jointly-tracked master (e.g. one Vanguard IRA both spouses
      // contribute to separately) has ownershipType "joint", but each
      // contribution_accounts row under it has its own real owner. Letting
      // the master's "joint" win here made every such row render with the
      // identical generic "Joint ..." label, with no way to tell which
      // unlinked row belonged to which person when picking a budget item
      // to link it to. See portfolioAccountLabel's identical precedence
      // rule for the analogous portfolio-snapshot-row case.
      const ownerPersonId = c.ownership === "individual" ? c.personId : null;
      // Always pass a perf-shaped object, even with no linked performance
      // account — falling back to `undefined` here would drop this
      // account's own ownership (c.ownership) entirely, since
      // portfolioAccountLabel's internal fallback only ever consults
      // perf.ownershipType, never the caller's own row. A joint
      // contribution account with no performance account linked yet (the
      // normal pre-linking state) would silently lose its "Joint" prefix.
      const label = portfolioAccountLabel(
        {
          accountType: c.accountType,
          subType: c.subType,
          label: c.label,
          institution: perf?.institution ?? "",
        },
        perf
          ? {
              displayName: perf.displayName,
              accountLabel: perf.accountLabel,
              ownershipType: perf.ownershipType,
            }
          : {
              displayName: null,
              accountLabel: null,
              ownershipType: c.ownership,
            },
        ownerPersonId,
        personMap,
      );
      // Two of one person's own accounts (e.g. a Roth and a Traditional
      // IRA) commonly share the same owner + institution + account type,
      // so the label above alone doesn't distinguish them — always append
      // tax treatment here rather than only on a detected collision, since
      // a collision-only rule fails silently the moment a third account
      // shares the same three fields. Matches how the Portfolio page
      // always shows tax treatment as its own separate label, never
      // conditionally.
      const taxLabel = TAX_TREATMENT_LABELS[c.taxTreatment] ?? c.taxTreatment;
      return {
        id: c.id,
        accountType: c.accountType,
        displayLabel: `${label} — ${taxLabel}`,
      };
    });
  }),
};
