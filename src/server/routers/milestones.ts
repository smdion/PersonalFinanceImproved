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
  SK_MILESTONE_CHECKPOINT_SOURCE,
  SK_MILESTONE_CUSTOM_GOALS,
  SK_MILESTONE_SAVINGS_TARGET_SOURCE,
} from "@/lib/constants/settings-keys";
import { parseMilestoneSettings } from "@/lib/pure/milestones";
import { milestoneYearFromHistory } from "@/lib/pure/milestone-input";
import { zYearEndTargeting } from "./_shared";
import type { MilestoneDebt } from "@/lib/pure/milestones";
import { debtPayoffEstimate } from "@/lib/pure/debts";
import { getAge, localDateStr } from "@/lib/utils/date";
import { toNumber } from "@/server/helpers";
import {
  getEffectiveOtherLiabilities,
  isOpenDebt,
} from "@/server/helpers/debts";

export const milestonesRouter = createTRPCRouter({
  /** Year-end history mapped for the Milestones engine, plus the household's own goals and checklist. */
  computeInputs: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const asOfDate = new Date();
      const [history, settingRows, debtRows, people, otherDebt] =
        await Promise.all([
          buildYearEndHistory(ctx.db, asOfDate, {
            budgetProfileId: input?.budgetProfileId,
            budgetColumn: input?.budgetColumn,
          }),
          ctx.db
            .select()
            .from(schema.appSettings)
            .where(
              inArray(schema.appSettings.key, [
                SK_MILESTONE_CUSTOM_GOALS,
                SK_MILESTONE_CHECKLIST,
                SK_MILESTONE_CHECKPOINT_SOURCE,
                SK_MILESTONE_SAVINGS_TARGET_SOURCE,
              ]),
            ),
          ctx.db.select().from(schema.debts),
          ctx.db.select().from(schema.people),
          getEffectiveOtherLiabilities(ctx.db),
        ]);
      const setting = (key: string) =>
        settingRows.find((r) => r.key === key)?.value ?? null;
      const current =
        history.find((h) => h.isCurrent) ?? history[history.length - 1];
      // Each debt judged at its owner's age today, by birthday (a joint
      // debt: the household's average age, as every other milestone uses —
      // 0, the most lenient band, only when there are no people at all).
      const today = localDateStr(asOfDate);
      const householdAge = current?.averageAge ?? 0;
      const ageOf = (personId: number | null) => {
        const p = people.find((x) => x.id === personId);
        return p
          ? getAge(new Date(`${p.dateOfBirth}T00:00:00`), asOfDate)
          : householdAge;
      };
      const debts: MilestoneDebt[] = debtRows.map((d) => {
        const balance = toNumber(d.balance);
        const rate = d.interestRate == null ? null : toNumber(d.interestRate);
        const open = isOpenDebt(d, today);
        const est = debtPayoffEstimate(
          {
            balance,
            interestRate: rate,
            monthlyPayment:
              d.monthlyPayment == null ? null : toNumber(d.monthlyPayment),
            balanceAsOf: d.balanceAsOf,
          },
          today,
        );
        return {
          name: d.name,
          kind: d.kind,
          balance,
          rate,
          ownerAge: ageOf(d.ownerPersonId),
          open,
          payoffYear: est.payoffMonth
            ? Number(est.payoffMonth.slice(0, 4))
            : null,
          never: est.never,
          stale: open && est.stale,
          paidOffYear: d.paidOffDate ? Number(d.paidOffDate.slice(0, 4)) : null,
        };
      });
      return {
        asOfYear: asOfDate.getFullYear(),
        years: history.map((row) =>
          milestoneYearFromHistory({
            ...row,
            grossIncome: wealthFormulaIncome(row),
          }),
        ),
        fiTarget: current?.fiTarget ?? 0,
        debts,
        otherDebt: {
          manual: otherDebt.manual,
          creditCardMapped: otherDebt.creditCardMapped,
        },
        ...parseMilestoneSettings({
          customGoals: setting(SK_MILESTONE_CUSTOM_GOALS),
          checklist: setting(SK_MILESTONE_CHECKLIST),
          checkpointSource: setting(SK_MILESTONE_CHECKPOINT_SOURCE),
          savingsTargetSource: setting(SK_MILESTONE_SAVINGS_TARGET_SOURCE),
        }),
      };
    }),
});
