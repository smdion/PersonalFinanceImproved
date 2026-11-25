/** Contribution accounts of a type this version doesn't know, as the readers
 *  outside the projection take them: left out, and each one named. */
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { logWarnOnce } from "@/lib/logger";
import { getAllPeople } from "@/server/data/people";
import { getActiveContributionAccountsByType } from "@/server/data/contribution-accounts";
import {
  contributionsByType,
  unknownTypeContributionNote,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";
import { contributionAccountName } from "@/server/services/contributions/account-name";

type ContributionAccountRow = typeof schema.contributionAccounts.$inferSelect;

/** One text per account in `rows`, each named as the Contributions page
 *  names it and worded by `word`; no rows, no reads. */
async function unknownTypeTexts(
  db: DbOrTx,
  rows: readonly ContributionAccountRow[],
  word: (name: string, accountType: string) => string,
): Promise<string[]> {
  if (rows.length === 0) return [];
  const [people, jobs, performanceAccounts] = await Promise.all([
    getAllPeople(db),
    db.select().from(schema.jobs),
    db.select().from(schema.performanceAccounts),
  ]);
  const performanceAccountsById = new Map(
    performanceAccounts.map((p) => [p.id, p]),
  );
  const nameMap = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((row) =>
    word(
      contributionAccountName(row, { performanceAccountsById, jobs }, nameMap),
      row.accountType,
    ),
  );
}

/** The known active accounts in id order, as a page that reads them itself
 *  (Contributions, Paycheck) takes them, and the note for each unknown one. */
export async function loadPageContributionAccounts(db: DbOrTx) {
  const { known, unknown } = await getActiveContributionAccountsByType(db);
  const notes = await unknownTypeTexts(
    db,
    unknown,
    unknownTypeContributionNote,
  );
  return { known, notes };
}

/** Why a job's net pay per check can't be figured: its deduction for an
 *  account of an unknown type isn't counted, so a stored figure would be
 *  too high. */
function unknownTypeDeductionNote(name: string, accountType: string): string {
  return `${name} is saved as account type "${accountType}", which this version doesn't know, so its paycheck deduction can't be counted and the net pay per check isn't saved. Update Ledgr to a version that knows this type.`;
}

/** A job's and its person's accounts (`job`, `personal`) of a known type,
 *  and why its net pay can't be stored (`notes`, logged) when one isn't. */
export async function jobContributionsByType(
  db: DbOrTx,
  rows: { job: ContributionAccountRow[]; personal: ContributionAccountRow[] },
) {
  const job = contributionsByType(rows.job);
  const personal = contributionsByType(rows.personal);
  const unknown = [...job.unknown, ...personal.unknown];
  const notes = await unknownTypeTexts(db, unknown, unknownTypeDeductionNote);
  if (unknown.length > 0)
    logWarnOnce(
      "net_pay_unknown_account_type",
      unknown.map((r) => r.id).join(),
      {
        accountIds: unknown.map((r) => r.id),
      },
    );
  return { job: job.known, personal: personal.known, notes };
}
