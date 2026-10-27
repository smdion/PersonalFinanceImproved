/**
 * This year's filing status (lib/pure/filing-status.ts has the whole
 * chain): the household setting, else the active Retirement Profile's,
 * else a W-4 — with where it came from. One resolver for the paycheck, the
 * caps and the retirement engine.
 */
import type { W4FilingStatus } from "@/lib/config/enum-values";
import {
  taxFilingStatusSetting,
  type FilingStatusSource,
} from "@/lib/pure/filing-status";
import { w4FilingStatusOf, type SalaryProfileActiveMap } from "./salary";
import type { Db } from "./transforms";

/** People ids, the primary person first (whose W-4 stands in first). */
export function primaryFirst(
  people: readonly { id: number; isPrimaryUser: boolean }[],
): number[] {
  return [...people]
    .sort((a, b) => Number(b.isPrimaryUser) - Number(a.isPrimaryUser))
    .map((p) => p.id);
}

export async function thisYearFilingStatus(
  db: Db,
  args: {
    appSettings: readonly { key: string; value: unknown }[];
    /** The active Retirement Profile's (null = Auto / none). */
    profileStatus: W4FilingStatus | null | undefined;
    people: readonly { id: number; isPrimaryUser: boolean }[];
    /** The request's Salary Profile (What-If included); absent = active. */
    salaryProfileActiveMap?: SalaryProfileActiveMap;
  },
): Promise<{
  status: W4FilingStatus | null;
  source: FilingStatusSource | null;
}> {
  const household = taxFilingStatusSetting(args.appSettings);
  if (household) return { status: household, source: "household" };
  if (args.profileStatus)
    return { status: args.profileStatus, source: "retirementProfile" };
  const w4 = await w4FilingStatusOf(
    db,
    primaryFirst(args.people),
    args.salaryProfileActiveMap,
  );
  return w4 ? { status: w4, source: "w4" } : { status: null, source: null };
}
