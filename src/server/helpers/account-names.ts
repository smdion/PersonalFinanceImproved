/** Tracked (Ledgr) account names, built once for every server view that lists accounts. */
import * as schema from "@/lib/db/schema";
import { accountDisplayName } from "@/lib/utils/format";
import type { Db } from "./transforms";

/** Each tracked (Ledgr) account's name, as every page shows it (accountDisplayName). */
export async function loadTrackedAccountNames(
  db: Db,
): Promise<Map<number, string>> {
  const p = schema.performanceAccounts;
  const [perf, people] = await Promise.all([
    db
      .select({
        id: p.id,
        accountType: p.accountType,
        subType: p.subType,
        label: p.label,
        institution: p.institution,
        displayName: p.displayName,
        accountLabel: p.accountLabel,
        ownershipType: p.ownershipType,
        ownerPersonId: p.ownerPersonId,
      })
      .from(p),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((x) => [x.id, x.name]));
  return new Map(
    perf.map((a) => [
      a.id,
      accountDisplayName(
        a,
        a.ownerPersonId != null ? names.get(a.ownerPersonId) : undefined,
      ),
    ]),
  );
}
