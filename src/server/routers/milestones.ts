/** Milestones router — the year-level history and saved choices the
 *  Milestones engine (lib/pure/milestones.ts) reads. Judging happens in the
 *  pure engine; this only fetches and maps. */
import { inArray } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { buildYearEndHistory } from "@/server/helpers";
import { wealthFormulaIncome } from "@/lib/calculators/net-worth";
import {
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_CUSTOM_GOALS,
} from "@/lib/constants/settings-keys";
import {
  milestoneYearFromHistory,
  parseMilestoneSettings,
} from "@/lib/pure/milestones";
import { zYearEndTargeting, toSalaryActiveMap } from "./_shared";

export const milestonesRouter = createTRPCRouter({
  /** Year-end history mapped for the Milestones engine, plus the household's own goals and checklist. */
  computeInputs: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const asOfDate = new Date();
      const [history, settingRows] = await Promise.all([
        buildYearEndHistory(ctx.db, asOfDate, {
          budgetProfileId: input?.budgetProfileId,
          budgetColumn: input?.budgetColumn,
          salaryActiveFields: toSalaryActiveMap(input?.salaryActiveFields),
        }),
        ctx.db
          .select()
          .from(schema.appSettings)
          .where(
            inArray(schema.appSettings.key, [
              SK_MILESTONE_CUSTOM_GOALS,
              SK_MILESTONE_CHECKLIST,
            ]),
          ),
      ]);
      const setting = (key: string) =>
        settingRows.find((r) => r.key === key)?.value ?? null;
      const current =
        history.find((h) => h.isCurrent) ?? history[history.length - 1];
      return {
        asOfYear: asOfDate.getFullYear(),
        years: history.map((row) =>
          milestoneYearFromHistory({
            ...row,
            grossIncome: wealthFormulaIncome(row),
          }),
        ),
        fiTarget: current?.fiTarget ?? 0,
        ...parseMilestoneSettings({
          customGoals: setting(SK_MILESTONE_CUSTOM_GOALS),
          checklist: setting(SK_MILESTONE_CHECKLIST),
        }),
      };
    }),
});
