/**
 * The default high-income line for this household (lib/pure/paycheck/high-income-line.ts)
 * — from this year's filing status, the same resolver the paycheck and caps
 * use. The saved setting, when there is one, is applied by the client hook.
 */
import * as schema from "@/lib/db/schema";
import { defaultHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { getAllPeople } from "@/server/data/people";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import { loadActiveRetirementSettings } from "@/server/data/retirement-settings";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import type { Db } from "@/lib/db";

export async function householdHighIncomeLine(db: Db, asOf: Date) {
  const [appSettings, people] = await Promise.all([
    db.select().from(schema.appSettings),
    getAllPeople(db),
  ]);
  const settings = await loadActiveRetirementSettings(
    db,
    appSettings,
    getPrimaryPerson([...people])?.id ?? null,
  );
  const { status } = await thisYearFilingStatus(db, {
    appSettings,
    profileStatus: settings?.filingStatus,
    people,
    asOf,
  });
  return defaultHighIncomeLine(status, people.length);
}
