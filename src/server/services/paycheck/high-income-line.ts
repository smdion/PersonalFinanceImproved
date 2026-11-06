/**
 * The default high-income line for this household (lib/pure/paycheck/high-income-line.ts)
 * — from this year's filing status, the same resolver the paycheck and caps
 * use. The saved setting, when there is one, is applied by the client hook.
 */
import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { defaultHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { getAllPeople } from "@/server/data/people";
import { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import {
  pickProfileSettingsRow,
  resolveRetirementProfileIdFrom,
} from "@/lib/pure/household/retirement-profile";
import { getPrimaryPerson } from "@/lib/pure/household/primary-person";
import type { Db } from "@/lib/db";

export async function householdHighIncomeLine(db: Db) {
  const [appSettings, retSettings, retProfiles, people] = await Promise.all([
    db.select().from(schema.appSettings),
    db.select().from(schema.retirementSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
    getAllPeople(db),
  ]);
  const settings = pickProfileSettingsRow(
    retSettings,
    resolveRetirementProfileIdFrom(appSettings, retProfiles),
    getPrimaryPerson([...people])?.id ?? null,
  );
  const { status } = await thisYearFilingStatus(db, {
    appSettings,
    profileStatus: settings?.filingStatus,
    people,
  });
  return defaultHighIncomeLine(status, people.length);
}
