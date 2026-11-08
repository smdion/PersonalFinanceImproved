/** Milestones router — the year-level history and saved choices the
 *  Milestones engine (lib/pure/advice/milestones/milestones.ts) reads. Judging happens in the
 *  pure engine; this only fetches and maps. */
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { SK_MILESTONE_FIRST_REACHED } from "@/lib/constants/settings-keys";
import { evaluateMilestones } from "@/lib/pure/advice/milestones/milestones";
import {
  mergeFirstReached,
  parseFirstReached,
} from "@/lib/pure/advice/milestone-first-reached";
import { mergeSettingAtomically } from "@/server/data/settings";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import {
  activeMilestoneInput,
  loadMilestoneInputs,
} from "@/server/services/advice/milestone-inputs";

export const milestonesRouter = createTRPCRouter({
  /** Year-end history mapped for the Milestones engine, plus the household's own goals and checklist. */
  computeInputs: protectedProcedure
    .input(zYearEndTargeting)
    .query(({ ctx, input }) => loadMilestoneInputs(ctx, input)),

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
    const results = evaluateMilestones(await activeMilestoneInput(ctx));
    const today = ctx.scope.today;
    const reachedNow = results
      .filter((r) => r.status === "reached")
      .map((r) => ({ id: r.id, reachedYear: r.reachedYear }));
    return mergeSettingAtomically(ctx.db, SK_MILESTONE_FIRST_REACHED, (raw) =>
      mergeFirstReached(parseFirstReached(raw), reachedNow, today),
    );
  }),
});
