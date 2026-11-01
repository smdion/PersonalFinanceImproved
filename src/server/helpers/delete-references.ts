/**
 * Cleanup for references kept in JSON blobs, which no FK can cascade: a
 * deleted row's budget-API mappings and its Contribution Profile active
 * fields. Call inside the delete's transaction.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountMapping } from "@/lib/db/schema";
import type { DbOrTx } from "./transforms";
import { mappingWithTypedIds } from "@/lib/utils/account-mapping";

/** The kind of Ledgr row a mapping can point at. */
export type MappedRow =
  | { performanceAccountId: number }
  | { assetId: number }
  | { debtId: number }
  | { loanId: number };

function pointsAt(m: AccountMapping, row: MappedRow): boolean {
  const t = mappingWithTypedIds(m);
  if ("performanceAccountId" in row)
    return t.performanceAccountId === row.performanceAccountId;
  if ("assetId" in row) return t.assetId === row.assetId;
  if ("debtId" in row) return t.debtId === row.debtId;
  return t.loanId === row.loanId;
}

/** Removes every budget-API mapping (any service) that points at `row`. */
export async function dropMappingsTo(
  db: DbOrTx,
  row: MappedRow,
): Promise<void> {
  const conns = await db
    .select({
      id: schema.apiConnections.id,
      accountMappings: schema.apiConnections.accountMappings,
    })
    .from(schema.apiConnections);
  for (const c of conns) {
    const mappings = c.accountMappings ?? [];
    const kept = mappings.filter((m) => !pointsAt(m, row));
    if (kept.length === mappings.length) continue;
    await db
      .update(schema.apiConnections)
      .set({ accountMappings: kept })
      .where(eq(schema.apiConnections.id, c.id));
  }
}

/** Removes `id`'s entry under `entityType` from every Contribution Profile. */
export async function dropContributionActiveFields(
  db: DbOrTx,
  entityType: "contributionAccounts" | "deductions",
  id: number,
): Promise<void> {
  const profiles = await db
    .select({
      id: schema.contributionProfiles.id,
      contributionActiveFields:
        schema.contributionProfiles.contributionActiveFields,
    })
    .from(schema.contributionProfiles);
  const key = String(id);
  for (const p of profiles) {
    const byEntity = p.contributionActiveFields[entityType];
    if (!byEntity || !(key in byEntity)) continue;
    const { [key]: _drop, ...rest } = byEntity;
    await db
      .update(schema.contributionProfiles)
      .set({
        contributionActiveFields: {
          ...p.contributionActiveFields,
          [entityType]: rest,
        },
      })
      .where(eq(schema.contributionProfiles.id, p.id));
  }
}
