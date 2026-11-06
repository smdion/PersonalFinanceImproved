/**
 * Which stored SimpleFIN accounts take a new SimpleFIN id, and which errors
 * keep a missing account from counting as gone. Invented accounts only.
 */
import { describe, it, expect } from "vitest";
import {
  errorScope,
  pairCopiedTransactions,
  planReidentify,
  type ErrorScope,
  type StoredFeedIdentity,
} from "@/lib/pure/sync/simplefin-reidentify";

const ORG = "Example Retirement Co";
const CAPPED = /date range.*\bcapped\b/i;

function row(
  over: Partial<StoredFeedIdentity> & { id: number; externalAccountId: string },
): StoredFeedIdentity {
  return {
    orgName: ORG,
    accountName: "Example 401(k) Plan (1111)",
    linkedPerformanceAccountId: null,
    linkedSubKey: null,
    linkedLoanId: null,
    lastSeenAt: new Date("2026-11-06T08:49:00Z"),
    firstHistoryAt: null,
    ...over,
  };
}

const reported = (
  id: string,
  name = "Example 401(k) Plan (1111)",
  org = ORG,
) => ({
  id,
  orgName: org,
  name,
});

function plan(
  stored: StoredFeedIdentity[],
  accounts: ReturnType<typeof reported>[],
  opts: { erroredIds?: string[]; errorScope?: ErrorScope; now?: Date } = {},
) {
  return planReidentify({
    stored,
    reported: accounts,
    erroredIds: new Set(opts.erroredIds ?? []),
    errorScope: opts.errorScope ?? [],
    // A day and more after the old rows were last seen (08:49 on Nov 6).
    now: opts.now ?? new Date("2026-11-07T09:00:00Z"),
  });
}

const linkedOld = row({
  id: 10,
  externalAccountId: "old-401k",
  linkedPerformanceAccountId: 3,
});

describe("planReidentify: adopt a new id", () => {
  it("gives the one gone row with the same institution and name the new id", () => {
    expect(plan([linkedOld], [reported("new-401k")])).toEqual({
      adopt: [{ rowId: 10, externalAccountId: "new-401k" }],
      merge: [],
      ambiguous: [],
    });
  });

  it("adopts an unlinked row too: it keeps its included flag and history", () => {
    const unlinked = row({ id: 11, externalAccountId: "old" });
    expect(plan([unlinked], [reported("new")]).adopt).toEqual([
      { rowId: 11, externalAccountId: "new" },
    ]);
  });

  it("leaves a row SimpleFIN still reports: the new id is a second account", () => {
    const p = plan([linkedOld], [reported("old-401k"), reported("new-401k")]);
    expect(p).toEqual({ adopt: [], merge: [], ambiguous: [] });
  });

  it("leaves a row an error names, or whose institution an error covers", () => {
    const quiet = { adopt: [], merge: [], ambiguous: [] };
    expect(
      plan([linkedOld], [reported("new-401k")], { erroredIds: ["old-401k"] }),
    ).toEqual(quiet);
    expect(
      plan([linkedOld], [reported("new-401k")], { errorScope: [ORG] }),
    ).toEqual(quiet);
    expect(
      plan([linkedOld], [reported("new-401k")], { errorScope: "any" }),
    ).toEqual(quiet);
  });

  it("waits until the row has gone unreported for GONE_AFTER_HOURS", () => {
    const quiet = { adopt: [], merge: [], ambiguous: [] };
    expect(
      plan([linkedOld], [reported("new-401k")], {
        now: new Date("2026-11-07T08:48:00Z"),
      }),
    ).toEqual(quiet);
    expect(
      plan([linkedOld], [reported("new-401k")], {
        now: new Date("2026-11-07T08:49:00Z"),
      }).adopt,
    ).toHaveLength(1);
  });

  it("still adopts when the error covers another institution", () => {
    expect(
      plan([linkedOld], [reported("new-401k")], {
        errorScope: ["Example Bank"],
      }).adopt,
    ).toHaveLength(1);
  });

  it("matches the institution and the name exactly", () => {
    expect(
      plan(
        [linkedOld],
        [reported("new", "Example 401(k) Plan (1111)", "Other")],
      ).adopt,
    ).toEqual([]);
  });

  it("never pairs a row with no institution name", () => {
    const noOrg = row({ id: 12, externalAccountId: "old", orgName: "" });
    expect(plan([noOrg], [reported("new", noOrg.accountName, "")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [],
    });
  });

  it("reports two gone rows, or two new accounts, with the same name", () => {
    const twin = row({ id: 20, externalAccountId: "old-twin" });
    expect(plan([linkedOld, twin], [reported("new-401k")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [{ ids: [10, 20], reason: "several_candidates" }],
    });
    expect(plan([linkedOld], [reported("new-a"), reported("new-b")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [{ ids: [10], reason: "several_candidates" }],
    });
  });

  it("reports a linked row gone while a differently named account arrived there", () => {
    expect(
      plan([linkedOld], [reported("new", "Example 401(k) Plan (2222)")]),
    ).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [{ ids: [10], reason: "name_changed" }],
    });
  });

  it("changes nothing once adopted", () => {
    const adopted = { ...linkedOld, externalAccountId: "new-401k" };
    expect(plan([adopted], [reported("new-401k")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [],
    });
  });
});

describe("planReidentify: merge a copy already stored", () => {
  const copy = row({ id: 5040, externalAccountId: "new-401k" });
  const hsaOld = row({
    id: 13,
    externalAccountId: "old-hsa",
    accountName: "Health Savings Account (6456)",
    linkedPerformanceAccountId: 4,
  });
  const hsaCopy = row({
    id: 5041,
    externalAccountId: "new-hsa",
    accountName: "Health Savings Account (6456)",
  });

  it("merges each unlinked copy into the linked row it duplicates", () => {
    expect(
      plan(
        [linkedOld, copy, hsaOld, hsaCopy],
        [reported("new-401k"), reported("new-hsa", hsaCopy.accountName)],
      ),
    ).toEqual({
      adopt: [],
      merge: [
        { keepId: 10, dropId: 5040, externalAccountId: "new-401k" },
        { keepId: 13, dropId: 5041, externalAccountId: "new-hsa" },
      ],
      ambiguous: [],
    });
  });

  it("counts a part or a loan as a link", () => {
    const part = {
      ...linkedOld,
      linkedPerformanceAccountId: null,
      linkedSubKey: "3_x",
    };
    const loan = {
      ...linkedOld,
      linkedPerformanceAccountId: null,
      linkedLoanId: 7,
    };
    expect(plan([part, copy], [reported("new-401k")]).merge).toHaveLength(1);
    expect(plan([loan, copy], [reported("new-401k")]).merge).toHaveLength(1);
  });

  it("leaves a copy with a link of its own, or two unlinked rows, and says why", () => {
    const linkedCopy = { ...copy, linkedPerformanceAccountId: 9 };
    expect(
      plan([linkedOld, linkedCopy], [reported("new-401k")]).ambiguous,
    ).toEqual([{ ids: [10, 5040], reason: "reported_copy_linked" }]);
    const unlinkedOld = { ...linkedOld, linkedPerformanceAccountId: null };
    expect(plan([unlinkedOld, copy], [reported("new-401k")]).ambiguous).toEqual(
      [{ ids: [10, 5040], reason: "neither_linked" }],
    );
  });

  it("leaves a pairing that isn't one-to-one", () => {
    const third = row({
      id: 30,
      externalAccountId: "other",
      linkedPerformanceAccountId: 5,
    });
    expect(plan([linkedOld, copy, third], [reported("new-401k")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [{ ids: [10, 5040, 30], reason: "several_candidates" }],
    });
  });

  it("waits while the old row may only be missing behind an error", () => {
    expect(
      plan([linkedOld, copy], [reported("new-401k")], { errorScope: [ORG] }),
    ).toEqual({ adopt: [], merge: [], ambiguous: [] });
  });

  it("leaves a copy with history from while the row was still reported", () => {
    const seenBefore = {
      ...copy,
      firstHistoryAt: new Date("2026-10-01T00:00:00Z"),
    };
    expect(
      plan([linkedOld, seenBefore], [reported("new-401k")]).ambiguous,
    ).toEqual([{ ids: [10, 5040], reason: "reported_together" }]);
    const withinSlack = {
      ...copy,
      firstHistoryAt: new Date("2026-11-06T08:52:00Z"),
    };
    expect(
      plan([linkedOld, withinSlack], [reported("new-401k")]).ambiguous,
    ).toEqual([{ ids: [10, 5040], reason: "reported_together" }]);
    const seenAfter = {
      ...copy,
      firstHistoryAt: new Date("2026-11-06T09:04:00Z"),
    };
    expect(
      plan([linkedOld, seenAfter], [reported("new-401k")]).merge,
    ).toHaveLength(1);
  });

  it("merges only once the row has gone unreported for GONE_AFTER_HOURS", () => {
    const at = (iso: string) =>
      plan([linkedOld, copy], [reported("new-401k")], { now: new Date(iso) });
    expect(at("2026-11-07T08:48:00Z").merge).toEqual([]); // 23h59m
    expect(at("2026-11-07T08:49:00Z").merge).toHaveLength(1); // 24h
  });

  it("changes nothing once merged", () => {
    const merged = { ...linkedOld, externalAccountId: "new-401k" };
    expect(plan([merged], [reported("new-401k")])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [],
    });
  });
});

describe("planReidentify: an institution that wasn't re-added", () => {
  const stillLinked = row({
    id: 40,
    externalAccountId: "ira",
    accountName: "Example IRA (3333)",
    linkedPerformanceAccountId: 6,
  });

  it("leaves a missing row while another linked account there still reports", () => {
    const copy = row({ id: 5040, externalAccountId: "new-401k" });
    const reports = [
      reported("new-401k"),
      reported("ira", "Example IRA (3333)"),
    ];
    expect(plan([linkedOld, stillLinked], [reports[0]!, reports[1]!])).toEqual({
      adopt: [],
      merge: [],
      ambiguous: [{ ids: [10], reason: "institution_still_reporting" }],
    });
    expect(plan([linkedOld, copy, stillLinked], reports).ambiguous).toEqual([
      { ids: [10, 5040], reason: "institution_still_reporting" },
    ]);
  });
});

describe("pairCopiedTransactions", () => {
  const txn = (
    id: number,
    externalId: string,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    externalId,
    posted: "2026-10-15",
    amount: 250,
    description: "Contribution",
    pending: false,
    voided: false,
    ...over,
  });

  it("pairs the copy's rows under new ids with the kept row's, one to one", () => {
    expect(
      pairCopiedTransactions(
        [txn(1, "old-a"), txn(2, "old-b"), txn(3, "old-c", { amount: 99 })],
        [txn(10, "new-a"), txn(11, "new-b"), txn(12, "new-c")],
        "Medical withdrawal",
      ),
    ).toEqual([
      { keptId: 1, copyId: 10, externalId: "new-a" },
      { keptId: 2, copyId: 11, externalId: "new-b" },
    ]);
  });

  it("matches a redacted description, skips voided rows and exact-id clashes", () => {
    expect(
      pairCopiedTransactions(
        [
          txn(1, "old-a", { description: "Medical withdrawal" }),
          txn(2, "old-b", { voided: true }),
          txn(3, "same"),
        ],
        [
          txn(10, "new-a", { description: "Pharmacy" }),
          txn(11, "new-b"),
          txn(12, "same"),
        ],
        "Medical withdrawal",
      ),
    ).toEqual([{ keptId: 1, copyId: 10, externalId: "new-a" }]);
  });
});

describe("errorScope", () => {
  const names = new Map([
    ["CON-1", "Example Bank"],
    ["CON-2", ORG],
  ]);
  const scope = (body: Parameters<typeof errorScope>[0], unreadable = 0) =>
    errorScope(body, { unreadable }, names, CAPPED);

  it("is empty for a clean answer and for a capped-history notice", () => {
    expect(scope({ errors: [], errlist: [] })).toEqual([]);
    expect(
      scope({
        errors: [
          "Requested date range exceeds limit of 90 days and was capped",
        ],
      }),
    ).toEqual([]);
  });

  it("an error naming an account marks that account, not an institution", () => {
    expect(
      scope({
        errlist: [{ msg: "stale", account_id: "a1", conn_id: "CON-2" }],
      }),
    ).toEqual([]);
  });

  it("an error naming a connection covers its institution", () => {
    expect(
      scope({
        errors: ["Sign in again"],
        errlist: [{ msg: "Sign in again", conn_id: "CON-2" }],
      }),
    ).toEqual([ORG]);
  });

  it("covers every institution for an error that names none", () => {
    expect(scope({ errors: ["Something went wrong"] })).toBe("any");
    expect(scope({ errlist: [{ msg: "x", conn_id: "CON-9" }] })).toBe("any");
    expect(scope({ errlist: [{ msg: "x" }] })).toBe("any");
    expect(scope({}, 1)).toBe("any");
  });
});
