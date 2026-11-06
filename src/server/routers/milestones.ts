/** Milestones router — the year-level history and saved choices the
 *  Milestones engine (lib/pure/advice/milestones/milestones.ts) reads. Judging happens in the
 *  pure engine; this only fetches and maps. */
import { eq, inArray } from "drizzle-orm";
import {
  createCallerFactory,
  createTRPCRouter,
  internalCtx,
  protectedProcedure,
  type Context,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  SK_EFUND_BUDGET_COLUMN,
  SK_HIGH_INCOME_THRESHOLD,
  SK_MILESTONE_FIRST_REACHED,
} from "@/lib/constants/settings-keys";
import { evaluateMilestones } from "@/lib/pure/advice/milestones/milestones";
import { buildMilestoneInput } from "@/lib/pure/advice/milestones/input";
import {
  mergeFirstReached,
  parseFirstReached,
} from "@/lib/pure/advice/milestone-first-reached";
import { effectiveHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { householdHighIncomeLine } from "@/server/services/paycheck/high-income-line";
import { mergeSettingAtomically } from "@/server/data/settings";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { contributionRouter } from "./contribution";
import { savingsRouter } from "./savings";
import { mortgageRouter } from "./mortgage";
import { investmentsRouter } from "./investments";
import { brokerageRouter } from "./brokerage";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";

import { loadMilestoneInputs } from "@/server/services/advice/milestone-inputs";

export const milestonesRouter = createTRPCRouter({
  /** Year-end history mapped for the Milestones engine, plus the household's own goals and checklist. */
  computeInputs: protectedProcedure
    .input(zYearEndTargeting)
    .query(({ ctx, input }) => loadMilestoneInputs(ctx.db, input)),

  /** When each milestone was first reached (null before any recording). */
  firstReached: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_MILESTONE_FIRST_REACHED));
    return parseFirstReached(row?.value);
  }),

  /**
   * Record milestones reached now that aren't recorded yet. Judged here, on
   * the active profiles — never on what a page shows (it may be a What-If)
   * or on ids a browser sends. Any signed-in viewer's visit can record;
   * nothing goes to the change log (it's the app's own bookkeeping), and a
   * demo never records.
   */
  recordReached: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.demoSchema) return null;
    const results = evaluateMilestones(
      await activeMilestoneInput(ctx as Context),
    );
    const today = ctx.scope.today;
    const reachedNow = results
      .filter((r) => r.status === "reached")
      .map((r) => ({ id: r.id, reachedYear: r.reachedYear }));
    return mergeSettingAtomically(ctx.db, SK_MILESTONE_FIRST_REACHED, (raw) =>
      mergeFirstReached(parseFirstReached(raw), reachedNow, today),
    );
  }),
});

/** The milestone input on the active profiles, as the server sees it —
 *  no projection (reached never depends on it); holdings and brokerage
 *  goals when this viewer may see them. */
async function activeMilestoneInput(ctx: Context) {
  const inner = internalCtx(ctx);
  const settingRows = await ctx.db
    .select()
    .from(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        SK_EFUND_BUDGET_COLUMN,
        SK_HIGH_INCOME_THRESHOLD,
      ]),
    );
  const setting = (key: string) =>
    settingRows.find((r) => r.key === key)?.value ?? null;
  const efundColumn = setting(SK_EFUND_BUDGET_COLUMN);
  const optional = <T>(p: Promise<T>) => p.catch(() => null);
  // Contributions need the profile ids the page sends; with none they're $0.
  const { contribProfileId, salaryProfileId } =
    await resolveProfileSelection(ctx);
  const [
    inputs,
    contributions,
    savings,
    mortgage,
    holdings,
    buyingMonths,
    goals,
    line,
  ] = await Promise.all([
    loadMilestoneInputs(ctx.db, undefined),
    createCallerFactory(contributionRouter)(inner).computeSummary({
      ...(contribProfileId != null
        ? { contributionProfileId: contribProfileId }
        : {}),
      ...(salaryProfileId != null ? { salaryProfileId } : {}),
    }),
    createCallerFactory(savingsRouter)(inner).computeSummary(
      typeof efundColumn === "number" && efundColumn >= 0
        ? { budgetTierOverride: efundColumn }
        : undefined,
    ),
    createCallerFactory(mortgageRouter)(inner).computeActiveSummary(),
    optional(
      createCallerFactory(investmentsRouter)(inner).getHoldingsOverview(),
    ),
    optional(createCallerFactory(investmentsRouter)(inner).getBuyingMonths()),
    optional(createCallerFactory(brokerageRouter)(inner).listGoals()),
    householdHighIncomeLine(ctx.db),
  ]);
  const efund = savings.efund;
  return buildMilestoneInput({
    inputs,
    contributions,
    highIncomeThreshold: effectiveHighIncomeLine(
      setting(SK_HIGH_INCOME_THRESHOLD),
      line.threshold,
    ),
    efundMonths: efund
      ? (efund.monthsCoveredWithRepay ?? efund.monthsCovered)
      : null,
    efundEssentialMonthly:
      efund && efund.targetMonths > 0
        ? efund.targetAmount / efund.targetMonths
        : null,
    mortgage,
    projection: null,
    holdings,
    buyingMonths,
    brokerageGoals:
      goals?.map((g) => ({ name: g.name, targetYear: g.targetYear })) ?? null,
  });
}
