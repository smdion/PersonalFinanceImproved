// This year's filing status and where it came from (the whole chain is in
// lib/pure/filing-status.ts): one resolver for the paycheck, the caps and
// the retirement engine.
import type { W4FilingStatus } from "@/lib/config/filing-status";
import {
  taxFilingStatusSetting,
  type FilingStatusSource,
} from "@/lib/pure/filing-status";
import {
  w4FilingStatusOf,
  type SalaryProfileActiveMap,
} from "@/server/helpers/salary";
import type { Db } from "@/lib/db";

/** People ids, the primary person first (whose W-4 stands in first). */
function primaryFirst(
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
