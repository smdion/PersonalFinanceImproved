// This year's filing status and where it came from (the chain: lib/pure/tax/filing-status.ts;
// values and Zod: lib/config/filing-status.ts, filing-status.schema.ts): one resolver for the
// paycheck, the caps and the retirement engine.
import type {
  FilingStatusKey,
  ReturnFilingStatus,
  W4FilingStatus,
} from "@/lib/config/filing-status";
import {
  taxFilingStatusSetting,
  type FilingStatusSource,
} from "@/lib/pure/tax/filing-status";
import { type SalaryProfileActiveMap } from "@/lib/pure/household/compensation";
import { w4FilingStatusOf } from "@/server/services/profiles/salary-profile";
import type { DbOrTx } from "@/lib/db";

/** People ids, the primary person first (whose W-4 stands in first). */
function primaryFirst(
  people: readonly { id: number; isPrimaryUser: boolean }[],
): number[] {
  return [...people]
    .sort((a, b) => Number(b.isPrimaryUser) - Number(a.isPrimaryUser))
    .map((p) => p.id);
}

/** A W-4 box standing in for the return's status, called only here: a W-4
 *  is a withholding choice, used for the return when nothing else says. */
function w4StandInForReturn(w4: W4FilingStatus): ReturnFilingStatus {
  const spelling: FilingStatusKey = w4;
  return spelling;
}

export async function thisYearFilingStatus(
  db: DbOrTx,
  args: {
    appSettings: readonly { key: string; value: unknown }[];
    /** The active Retirement Profile's (null = Auto / none). */
    profileStatus: ReturnFilingStatus | null | undefined;
    people: readonly { id: number; isPrimaryUser: boolean }[];
    /** The request's date: the jobs held this year. */
    asOf: Date;
    /** The request's Salary Profile (What-If included); absent = active. */
    salaryProfileActiveMap?: SalaryProfileActiveMap;
  },
): Promise<{
  status: ReturnFilingStatus | null;
  source: FilingStatusSource | null;
}> {
  const household = taxFilingStatusSetting(args.appSettings);
  if (household) return { status: household, source: "household" };
  if (args.profileStatus)
    return { status: args.profileStatus, source: "retirementProfile" };
  const w4 = await w4FilingStatusOf(
    db,
    primaryFirst(args.people),
    args.asOf,
    args.salaryProfileActiveMap,
  );
  return w4
    ? { status: w4StandInForReturn(w4), source: "w4" }
    : { status: null, source: null };
}
