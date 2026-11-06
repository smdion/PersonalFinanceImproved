import { loansFedBySimplefin } from "@/server/services/sync/loan-feed";
import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { debtBalance, isOpenDebt } from "@/lib/pure/debts/debt-balance";
import {
  getApiConnection,
  cacheGet,
  type BudgetApiService,
  type BudgetAccount,
  type BudgetCategoryGroup,
  type BudgetMonthDetail,
} from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import { buildMortgageInputs } from "@/lib/pure/debts/mortgage-balance";
import {
  loadBudgetItemLinks,
  loadSavingsGoalLinks,
} from "@/server/data/category-links";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { calculateMortgage } from "@/lib/pure/debts/mortgage";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import { serviceEnum } from "./_shared";

export const previewProcedures = {
  /**
   * Preview: read cached data for a service and compare against current manual values.
   * Works before activation — shows what will change when the API is activated.
   */
  getPreview: protectedProcedure
    .input(z.object({ service: serviceEnum }))
    .query(async ({ ctx, input }) => {
      const service = input.service as BudgetApiService;

      const now = ctx.scope.asOf;
      const currentMonth = currentMonthKey(now);

      const currentYear = now.getFullYear();
      const [
        accountsCache,
        categoriesCache,
        monthCache,
        conn,
        settings,
        allProfiles,
        savingsGoalRows,
        latestSnapshot,
        assetItems,
        activeMortgageLoans,
        mortgageExtraPayments,
      ] = await Promise.all([
        cacheGet<BudgetAccount[]>(ctx.db, service, "accounts"),
        cacheGet<BudgetCategoryGroup[]>(ctx.db, service, "categories"),
        cacheGet<BudgetMonthDetail>(ctx.db, service, `months/${currentMonth}`),
        getApiConnection(ctx.db, service),
        ctx.db.select().from(schema.appSettings),
        ctx.db.select().from(schema.budgetProfiles),
        ctx.db.select().from(schema.savingsGoals),
        ctx.db
          .select()
          .from(schema.portfolioSnapshots)
          .orderBy(sql`${schema.portfolioSnapshots.snapshotDate} DESC`)
          .limit(1)
          .then((r) => r[0] ?? null),
        ctx.db.select().from(schema.otherAssetItems),
        ctx.db
          .select()
          .from(schema.mortgageLoans)
          .where(eq(schema.mortgageLoans.isActive, true)),
        ctx.db.select().from(schema.mortgageExtraPayments),
      ]);

      if (!accountsCache || !conn) {
        return { synced: false } as const;
      }

      const previewGoalPrimaryLinks = await loadSavingsGoalLinks(
        ctx.db,
        savingsGoalRows.map((g) => g.id),
        service,
        "primary",
      );
      const previewGoalReimbursementLinks = await loadSavingsGoalLinks(
        ctx.db,
        savingsGoalRows.map((g) => g.id),
        service,
        "reimbursement",
      );
      const savingsGoalRowsWithLinks = savingsGoalRows.map((g) => ({
        ...g,
        apiCategoryId: previewGoalPrimaryLinks.get(g.id)?.categoryId ?? null,
        apiCategoryName:
          previewGoalPrimaryLinks.get(g.id)?.categoryName ?? null,
        reimbursementApiCategoryId:
          previewGoalReimbursementLinks.get(g.id)?.categoryId ?? null,
      }));

      const accounts = accountsCache.data;
      const categoryGroups = categoriesCache?.data ?? [];

      // Compute what cash would be under API control — same precedence as
      // getEffectiveCash (server/services/budget/account-balances.ts): explicit "cash"
      // account mappings win when present (the only path that works for
      // Actual at all, which has no account-type field to auto-detect
      // from), else fall back to type-based
      // auto-detection (YNAB). This preview used to duplicate the
      // type-based logic independently, so it kept showing $0 even after
      // a household mapped Cash accounts — a household with mappings must
      // see the SAME total here as Net Worth/Assets, not a second,
      // differently-computed number.
      const cashMappings = (conn?.accountMappings ?? []).filter(
        (m) =>
          m.localId === "cash" &&
          (m.syncDirection === "pull" || m.syncDirection === "both"),
      );
      const cashTypes = new Set(["checking", "savings", "cash"]);
      const onBudgetCashAccounts =
        cashMappings.length > 0
          ? accounts.filter((a) =>
              cashMappings.some((m) => m.remoteAccountId === a.id),
            )
          : accounts.filter(
              (a) => a.onBudget && !a.closed && cashTypes.has(a.type),
            );
      const apiCash = onBudgetCashAccounts.reduce(
        (sum, a) => sum + a.balance,
        0,
      );

      // Current manual cash for comparison
      const setting = parseAppSettings(settings);
      const manualCash = setting("current_cash", 0);

      // Summarize accounts by type
      const accountsByType: Record<string, { count: number; balance: number }> =
        {};
      for (const a of accounts) {
        if (a.closed) continue;
        const entry = accountsByType[a.type] ?? { count: 0, balance: 0 };
        entry.count++;
        entry.balance += a.balance;
        accountsByType[a.type] = entry;
      }

      // Count categories
      const totalCategories = categoryGroups.reduce(
        (sum, g) => sum + g.categories.filter((c) => !c.hidden).length,
        0,
      );

      // -- Budget item matching --
      // Build a flat list of non-hidden API categories with their budgeted/activity/balance
      const monthCategories = monthCache?.data?.categories ?? [];
      const monthMap = new Map(monthCategories.map((c) => [c.id, c]));

      const apiCats: Array<{
        id: string;
        name: string;
        groupName: string;
        budgeted: number;
        activity: number;
        balance: number;
      }> = [];
      for (const g of categoryGroups) {
        if (g.hidden) continue;
        for (const c of g.categories) {
          if (c.hidden) continue;
          const m = monthMap.get(c.id);
          apiCats.push({
            id: c.id,
            name: c.name,
            groupName: g.name,
            budgeted: m?.budgeted ?? 0,
            activity: m?.activity ?? 0,
            balance: m?.balance ?? 0,
          });
        }
      }

      // Normalize name for fuzzy matching: strip non-alpha chars (emoji, parens, symbols), lowercase, trim
      const normalize = (s: string) =>
        s
          .replace(/\(.*?\)/g, "")
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      // Get budget items for linked profile (or fall back to active profile)
      const linkedProfile = conn.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      const activeProfile =
        linkedProfile ?? allProfiles.find((p) => p.isActive);
      let budgetItemRows: Array<{
        id: number;
        category: string;
        subcategory: string;
        amounts: number[];
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiSyncDirection: "pull" | "push" | "both" | null;
        contributionAccountId: number | null;
      }> = [];
      if (activeProfile) {
        const rawBudgetItemRows = await ctx.db
          .select({
            id: schema.budgetItems.id,
            category: schema.budgetItems.category,
            subcategory: schema.budgetItems.subcategory,
            amounts: schema.budgetItems.amounts,
            contributionAccountId: schema.budgetItems.contributionAccountId,
          })
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, activeProfile.id));
        const previewItemLinks = await loadBudgetItemLinks(
          ctx.db,
          rawBudgetItemRows.map((i) => i.id),
          service,
        );
        const linkedRows = rawBudgetItemRows.map((i) => {
          const link = previewItemLinks.get(i.id);
          return {
            ...i,
            apiCategoryId: link?.categoryId ?? null,
            apiCategoryName: link?.categoryName ?? null,
            apiSyncDirection: link?.syncDirection ?? null,
          };
        });
        // Contribution-linked items freeze `amounts` on edit (see
        // resolveLinkedBudgetItemAmounts docblock) — this preview must show
        // the same figure syncBudgetToApi would actually push, not the
        // stale DB column.
        const previewNumColumns = (activeProfile.columnLabels as string[])
          .length;
        const activeProfiles = await resolveProfileSelection(ctx.scope);
        budgetItemRows = await resolveLinkedBudgetItemAmounts(
          ctx.db,
          linkedRows,
          previewNumColumns,
          activeProfiles,
        );
      }

      // Determine which budget column to use (linked or active)
      const colIndex = conn.linkedColumnIndex ?? 0;

      // Match each budget item to API categories
      type BudgetMatch = {
        budgetItemId: number;
        ledgrName: string;
        ledgrCategory: string;
        ledgrAmount: number;
        status: "linked" | "suggested" | "unmatched" | "orphaned";
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiGroupName: string | null;
        apiBudgeted: number | null;
        apiActivity: number | null;
        syncDirection: "pull" | "push" | "both" | null;
        nameDrifted?: boolean;
        categoryDrifted?: boolean;
        contributionAccountId: number | null;
      };

      const usedApiIds = new Set<string>();
      const budgetMatches: BudgetMatch[] = [];

      // First pass: already linked items
      for (const item of budgetItemRows) {
        if (item.apiCategoryId) {
          const apiCat = apiCats.find((c) => c.id === item.apiCategoryId);
          usedApiIds.add(item.apiCategoryId);
          const currentApiName = apiCat?.name ?? item.apiCategoryName;
          if (!apiCat) {
            // The stored id doesn't resolve to any current API category —
            // e.g. the household's budget was rebuilt/re-imported upstream,
            // which regenerates every category's id while keeping its name
            // and balance. Previously this still reported "linked" purely
            // because SOME id was stored, with no check that it still
            // resolves — a push would then silently write to a category
            // that no longer exists, reporting success with nothing to show
            // for it. Reported as "orphaned" so the
            // UI can surface it distinctly and offer a re-link, instead of
            // silently masquerading as a working link.
            budgetMatches.push({
              budgetItemId: item.id,
              ledgrName: item.subcategory,
              ledgrCategory: item.category,
              ledgrAmount: item.amounts[colIndex] ?? 0,
              status: "orphaned",
              apiCategoryId: item.apiCategoryId,
              apiCategoryName: currentApiName,
              apiGroupName: null,
              apiBudgeted: null,
              apiActivity: null,
              syncDirection: item.apiSyncDirection,
              contributionAccountId: item.contributionAccountId,
            });
            continue;
          }
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "linked",
            apiCategoryId: item.apiCategoryId,
            apiCategoryName: currentApiName,
            apiGroupName: apiCat?.groupName ?? null,
            apiBudgeted: apiCat?.budgeted ?? null,
            apiActivity: apiCat?.activity ?? null,
            syncDirection: item.apiSyncDirection,
            nameDrifted:
              currentApiName != null && item.subcategory !== currentApiName,
            categoryDrifted:
              apiCat?.groupName != null && item.category !== apiCat.groupName,
            contributionAccountId: item.contributionAccountId,
          });
        }
      }

      // Second pass: fuzzy match unlinked items
      for (const item of budgetItemRows) {
        if (item.apiCategoryId) continue;
        const normSub = normalize(item.subcategory);
        const match = apiCats.find(
          (c) => !usedApiIds.has(c.id) && normalize(c.name) === normSub,
        );
        if (match) {
          usedApiIds.add(match.id);
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "suggested",
            apiCategoryId: match.id,
            apiCategoryName: match.name,
            apiGroupName: match.groupName,
            apiBudgeted: match.budgeted,
            apiActivity: match.activity,
            syncDirection: null,
            contributionAccountId: item.contributionAccountId,
          });
        } else {
          budgetMatches.push({
            budgetItemId: item.id,
            ledgrName: item.subcategory,
            ledgrCategory: item.category,
            ledgrAmount: item.amounts[colIndex] ?? 0,
            status: "unmatched",
            apiCategoryId: null,
            apiCategoryName: null,
            apiGroupName: null,
            apiBudgeted: null,
            apiActivity: null,
            syncDirection: null,
            contributionAccountId: item.contributionAccountId,
          });
        }
      }

      // -- Savings goal matching --
      type SavingsMatch = {
        goalId: number;
        goalName: string;
        status: "linked" | "suggested" | "unmatched" | "orphaned";
        apiCategoryId: string | null;
        apiCategoryName: string | null;
        apiBalance: number | null;
        nameDrifted?: boolean;
        isEmergencyFund: boolean;
        reimbursementApiCategoryId: string | null;
      };

      const usedSavingsApiIds = new Set<string>();
      const savingsMatches: SavingsMatch[] = [];

      for (const goal of savingsGoalRowsWithLinks) {
        if (goal.apiCategoryId) {
          const apiCat = apiCats.find((c) => c.id === goal.apiCategoryId);
          usedSavingsApiIds.add(goal.apiCategoryId);
          const currentApiName = apiCat?.name ?? goal.apiCategoryName;
          if (!apiCat) {
            // See the matching budget-item comment above — a stored id that
            // no longer resolves to any current API category must not be
            // reported as "linked".
            savingsMatches.push({
              goalId: goal.id,
              goalName: goal.name,
              status: "orphaned",
              apiCategoryId: goal.apiCategoryId,
              apiCategoryName: currentApiName,
              apiBalance: null,
              isEmergencyFund: goal.isEmergencyFund,
              reimbursementApiCategoryId:
                goal.reimbursementApiCategoryId ?? null,
            });
            continue;
          }
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "linked",
            apiCategoryId: goal.apiCategoryId,
            apiCategoryName: currentApiName,
            apiBalance: apiCat?.balance ?? null,
            nameDrifted: currentApiName != null && goal.name !== currentApiName,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        }
      }

      // Fuzzy match unlinked savings goals
      for (const goal of savingsGoalRowsWithLinks) {
        if (goal.apiCategoryId) continue;
        const normGoal = normalize(goal.name);
        const match = apiCats.find(
          (c) =>
            !usedApiIds.has(c.id) &&
            !usedSavingsApiIds.has(c.id) &&
            normalize(c.name) === normGoal,
        );
        if (match) {
          usedSavingsApiIds.add(match.id);
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "suggested",
            apiCategoryId: match.id,
            apiCategoryName: match.name,
            apiBalance: match.balance,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        } else {
          savingsMatches.push({
            goalId: goal.id,
            goalName: goal.name,
            status: "unmatched",
            apiCategoryId: null,
            apiCategoryName: null,
            apiBalance: null,
            isEmergencyFund: goal.isEmergencyFund,
            reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
          });
        }
      }

      // API categories with no Ledgr match (budget or savings)
      const skippedIds = new Set(conn.skippedCategoryIds ?? []);
      const allUnmatchedApi = apiCats
        .filter((c) => !usedApiIds.has(c.id) && !usedSavingsApiIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          budgeted: c.budgeted,
        }));
      const unmatchedApi = allUnmatchedApi.filter((c) => !skippedIds.has(c.id));
      const skippedApi = allUnmatchedApi.filter((c) => skippedIds.has(c.id));

      // -- Portfolio → tracking account mapping preview --
      const trackingAccounts = accounts
        .filter((a) => !a.onBudget && !a.closed)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: a.balance,
          type: a.type,
        }));

      // Every non-closed account, on-budget included — the remote-account
      // picker for the "Cash" and "Credit Card" pseudo-mappings needs
      // on-budget checking/savings/credit-card accounts, which
      // trackingAccounts (off-budget only) excludes by design. Actual's API
      // has no account "type" field at all (the
      // wrapper's own schema only has id/name/offbudget/closed), so there's
      // no way to auto-restrict this list to "checking/savings-like"
      // accounts; the household picks manually instead.
      const allAccounts = accounts
        .filter((a) => !a.closed)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: a.balance,
          type: a.type,
        }));

      // Get portfolio account labels (aggregated by performanceAccountId) from latest snapshot
      let portfolioLocalAccounts: Array<{
        label: string;
        balance: number;
        performanceAccountId: number | null;
        ownerPersonId: number | null;
      }> = [];
      if (latestSnapshot) {
        const [snapAccts, allPeople, perfAccounts] = await Promise.all([
          ctx.db
            .select()
            .from(schema.portfolioAccounts)
            .where(eq(schema.portfolioAccounts.snapshotId, latestSnapshot.id)),
          ctx.db.select().from(schema.people),
          ctx.db.select().from(schema.performanceAccounts),
        ]);
        const peopleMap = new Map(allPeople.map((p) => [p.id, p.name]));
        const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

        // Aggregate by performanceAccountId + ownerPersonId for stable identity.
        // Two people may share the same performanceAccountId (e.g. both have an IRA
        // at the same institution) — they must appear as separate line items.
        // ownerPersonId is carried through to the client (not just used for
        // the label) because the label alone isn't safe identity — two
        // people's labels only differ when accountDisplayName resolves them
        // differently, which silently stops being true if a displayName is
        // ever set on the shared performance account. See
        // portfolio-section.tsx, which keys/values its <option>s on the
        // (performanceAccountId, ownerPersonId) tuple this map already dedupes on.
        const perfOwnerMap = new Map<
          string,
          {
            perfId: number;
            ownerPersonId: number | null;
            label: string;
            balance: number;
          }
        >();
        for (const a of snapAccts) {
          if (!a.performanceAccountId) continue;
          const perf = perfMap.get(a.performanceAccountId);
          const label = portfolioAccountLabel(
            a,
            perf,
            a.ownerPersonId,
            peopleMap,
          );
          const key = `${a.performanceAccountId}:${a.ownerPersonId ?? ""}`;
          const existing = perfOwnerMap.get(key);
          if (existing) {
            existing.balance += Number(a.amount);
          } else {
            perfOwnerMap.set(key, {
              perfId: a.performanceAccountId,
              ownerPersonId: a.ownerPersonId,
              label,
              balance: Number(a.amount),
            });
          }
        }
        portfolioLocalAccounts = Array.from(perfOwnerMap.values())
          .map(({ perfId, ownerPersonId, label, balance }) => ({
            label,
            balance,
            performanceAccountId: perfId,
            ownerPersonId,
          }))
          .sort((a, b) => b.balance - a.balance);
      }

      const existingMappings = conn.accountMappings ?? [];

      // Build asset items list (carry-forward: latest value per name where year <= currentYear)
      const assetByName = new Map<
        string,
        { id: number; value: number; year: number }
      >();
      for (const a of assetItems) {
        if (a.year > currentYear) continue;
        const existing = assetByName.get(a.name);
        if (!existing || a.year > existing.year) {
          assetByName.set(a.name, {
            id: a.id,
            value: Number(a.value),
            year: a.year,
          });
        }
      }
      const assetLocalAccounts = Array.from(assetByName.entries())
        .map(([name, { id, value }]) => ({ label: name, balance: value, id }))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

      // Build mortgage mapping options with computed balances
      const { loanInputs: mortInputs, extras: mortExtras } =
        buildMortgageInputs(activeMortgageLoans, mortgageExtraPayments);
      const mortResult =
        activeMortgageLoans.length > 0
          ? calculateMortgage({
              loans: mortInputs,
              extraPayments: mortExtras,
              whatIfScenarios: [],
              asOfDate: ctx.scope.asOf,
            })
          : null;
      const feedLoans = await loansFedBySimplefin(ctx.db);
      const mortgageAccounts: Array<{
        label: string;
        id: number;
        type: "propertyValue" | "loanBalance";
        value: number;
        calculatedBalance?: number;
        apiBalance?: number;
        apiBalanceDate?: string | null;
        fedBySimplefin?: boolean;
      }> = [];
      for (const loan of activeMortgageLoans) {
        mortgageAccounts.push({
          label: `${loan.name} — Property Value`,
          id: loan.id,
          type: "propertyValue",
          value: Number(
            loan.propertyValueEstimated ?? loan.propertyValuePurchase,
          ),
        });
        const loanResult = mortResult?.loans.find((r) => r.loanId === loan.id);
        mortgageAccounts.push({
          label: `${loan.name} — Loan Balance`,
          id: loan.id,
          type: "loanBalance",
          value: -(
            loanResult?.currentBalance ?? Number(loan.originalLoanAmount)
          ),
          calculatedBalance:
            loanResult?.calculatedBalance ?? loanResult?.currentBalance,
          apiBalance: loanResult?.apiBalance,
          apiBalanceDate: loan.apiBalanceDate,
          fedBySimplefin: feedLoans.has(loan.id),
        });
      }

      // Open debts, each a pull target for its balance (as a loan balance).
      const today = ctx.scope.today;
      const debtAccounts = (await ctx.db.select().from(schema.debts))
        .filter((d) => isOpenDebt(d, today))
        .map((d) => {
          const now = debtBalance(d);
          return {
            label: d.name,
            id: d.id,
            value: -now.balance,
            enteredBalance: Number(d.balance),
            apiBalance: d.apiBalance == null ? undefined : Number(d.apiBalance),
            apiBalanceDate: d.apiBalanceDate,
          };
        });

      return {
        synced: true,
        fetchedAt: accountsCache.fetchedAt,
        lastSyncedAt: conn.lastSyncedAt,
        cash: {
          manual: manualCash,
          api: apiCash,
          apiAccounts: onBudgetCashAccounts.map((a) => ({
            name: a.name,
            balance: a.balance,
            type: a.type,
          })),
        },
        accounts: {
          total: accounts.filter((a) => !a.closed).length,
          onBudget: accounts.filter((a) => a.onBudget && !a.closed).length,
          tracking: accounts.filter((a) => !a.onBudget && !a.closed).length,
          byType: accountsByType,
        },
        categories: {
          groups: categoryGroups.filter((g) => !g.hidden).length,
          total: totalCategories,
        },
        // All API categories for dropdown pickers
        apiCategories: apiCats.map((c) => ({
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          budgeted: c.budgeted,
        })),
        // Budget profile info
        profile: {
          linkedProfileId: conn.linkedProfileId,
          linkedProfileName: activeProfile?.name ?? null,
          linkedColumnIndex: conn.linkedColumnIndex ?? 0,
          columnLabels: activeProfile?.columnLabels ?? [],
          availableProfiles: allProfiles.map((p) => ({
            id: p.id,
            name: p.name,
            isActive: p.isActive,
            columnLabels: p.columnLabels,
          })),
        },
        // Portfolio → tracking account data
        portfolio: {
          snapshotDate: latestSnapshot?.snapshotDate ?? null,
          localAccounts: portfolioLocalAccounts,
          assetAccounts: assetLocalAccounts,
          mortgageAccounts,
          debtAccounts,
          trackingAccounts,
          allAccounts,
          existingMappings,
        },
        budget: {
          matches: budgetMatches,
          unmatchedApiCategories: unmatchedApi,
          skippedApiCategories: skippedApi,
          summary: {
            linked: budgetMatches.filter((m) => m.status === "linked").length,
            suggested: budgetMatches.filter((m) => m.status === "suggested")
              .length,
            unmatched: budgetMatches.filter((m) => m.status === "unmatched")
              .length,
            orphaned: budgetMatches.filter((m) => m.status === "orphaned")
              .length,
            apiOnly: unmatchedApi.length,
          },
        },
        savings: {
          matches: savingsMatches,
          summary: {
            linked: savingsMatches.filter((m) => m.status === "linked").length,
            suggested: savingsMatches.filter((m) => m.status === "suggested")
              .length,
            unmatched: savingsMatches.filter((m) => m.status === "unmatched")
              .length,
            orphaned: savingsMatches.filter((m) => m.status === "orphaned")
              .length,
          },
        },
      } as const;
    }),
};
