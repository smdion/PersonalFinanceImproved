/**
 * The restore step's performance links (O2 (a)): a backup from before the
 * credentials tag gets the start-up backfill's match once, a contribution
 * account with no performance account taking the first whose label holds
 * its type and whose owner is its person (or whose label holds its
 * person's name); a joint row matches only an unowned account; a linked
 * row is kept; a backup from the tag on is left as it is.
 */
import { describe, it, expect } from "vitest";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { restoreLinks } from "@/lib/db/backup/restore-links";

const BEFORE = "0017_v0102_match_value";

const account = (
  id: number,
  personId: number | null,
  accountType: string,
  performanceAccountId: number | null = null,
) => ({
  id,
  person_id: personId,
  account_type: accountType,
  sub_type: null,
  performance_account_id: performanceAccountId,
});

const backup = () => ({
  people: [
    { id: 1, name: "Avery" },
    { id: 2, name: "Blake" },
  ],
  performance_accounts: [
    { id: 20, account_label: "Avery's Invented 401k", owner_person_id: 1 },
    { id: 21, account_label: "Invented 401k for Blake", owner_person_id: null },
    {
      id: 22,
      account_label: "Joint Invented Brokerage",
      owner_person_id: null,
    },
    { id: 23, account_label: "Invented HSA", owner_person_id: 2 },
  ],
  contribution_accounts: [
    account(1, 1, "401k"),
    account(2, 2, "401k"),
    account(3, null, "brokerage"),
    account(4, null, "ira"),
    account(5, 1, "hsa"),
    account(6, 2, "hsa", 99),
  ],
});

const linksOf = (t: ReturnType<typeof backup>) =>
  t.contribution_accounts.map((c) => c.performance_account_id);

describe("the restore step's performance links", () => {
  it("links each unlinked row as the start-up backfill did, before the tag", () => {
    const t = backup();
    restoreLinks(t, BEFORE);
    // 1: owner; 2: name in the label; 3: joint, unowned brokerage;
    // 4: joint, no unowned IRA; 5: owner differs, name absent; 6: kept.
    expect(linksOf(t)).toEqual([20, 21, 22, null, null, 99]);
  });

  it("leaves a backup from the tag on alone", () => {
    const t = backup();
    restoreLinks(t, CREDENTIALS_TAG);
    expect(linksOf(t)).toEqual([null, null, null, null, null, 99]);
  });

  it("links nothing when the backup has no performance accounts", () => {
    const t = { ...backup(), performance_accounts: [] };
    restoreLinks(t, BEFORE);
    expect(linksOf(t)).toEqual([null, null, null, null, null, 99]);
  });
});
