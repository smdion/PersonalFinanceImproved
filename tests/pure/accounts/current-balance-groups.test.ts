/**
 * Accounts whose feeds send no holdings: a balance that moved shows its
 * change, never a market move of zero; one that didn't (true cash) keeps
 * its zero.
 */
import { describe, it, expect } from "vitest";
import {
  groupCurrentBalances,
  noHoldingsInto,
  noHoldingsTitle,
  unpricedMoves,
} from "@/lib/pure/accounts/current-balance-groups";
import {
  missingNote,
  missingReason,
  noHoldingsLine,
} from "@/lib/pure/net-worth/close-notes";

const SESSIONS = ["2026-11-05", "2026-11-04"];
/** Each feed's balance on each close. */
const BALANCES: Record<number, Record<string, number>> = {
  13: { "2026-11-03": 1000, "2026-11-04": 1200, "2026-11-05": 1048.92 },
  14: { "2026-11-03": 500, "2026-11-04": 500, "2026-11-05": 500 },
};
const balanceAt = (id: number, day: string, exact: boolean) => {
  const days = Object.keys(BALANCES[id] ?? {})
    .filter((d) => (exact ? d === day : d <= day))
    .sort();
  const d = days.at(-1);
  return d ? BALANCES[id]![d]! : null;
};
const row = (key: string, feedIds: number[], perf: number | null = 4) => ({
  key,
  label: key === "hsa" ? "Voya HSA" : "Cash",
  account: key === "hsa" ? "Voya HSA" : "Cash",
  feedIds,
  performanceAccountId: perf,
});
const moves = (balances: ReturnType<typeof row>[], market: string[] = []) =>
  unpricedMoves({
    balances,
    marketKeys: new Set(market),
    institutionOf: () => "Voya Financial",
    sessions: SESSIONS,
    balanceAt,
  });

describe("unpricedMoves", () => {
  it("a no-holdings balance that moved: its change into each close", () => {
    expect(moves([row("hsa", [13])])).toEqual([
      {
        key: "hsa",
        performanceAccountId: 4,
        label: "Voya HSA",
        account: "Voya HSA",
        institution: "Voya Financial",
        changed: [
          { day: "2026-11-05", balance: -151.08 },
          { day: "2026-11-04", balance: 200 },
        ],
      },
    ]);
  });

  it("an unchanged balance (true cash) isn't listed: it keeps +$0.00", () => {
    expect(moves([row("cash", [14])])).toEqual([]);
  });

  it("market accounts, unmatched feeds and parts with no feed aren't listed", () => {
    expect(
      moves([row("hsa", [13]), row("x", [13], null), row("part", [])], ["hsa"]),
    ).toEqual([]);
  });

  it("a close with no balance on either side can't be told", () => {
    expect(
      unpricedMoves({
        balances: [row("hsa", [13])],
        marketKeys: new Set(),
        institutionOf: () => "Voya",
        sessions: ["2026-11-03"],
        balanceAt,
      }),
    ).toEqual([]);
  });
});

describe("groupCurrentBalances with no holdings", () => {
  const unpriced = moves([row("hsa", [13])]);
  const into = noHoldingsInto(unpriced, "2026-11-05");
  const balance = (key: string, current: number, move: number | null) => ({
    key,
    current,
    market: move !== null,
    move,
    noHoldings: into.get(key) ?? null,
  });

  it("the row's move is unknown, its balance change on hover", () => {
    const [g] = groupCurrentBalances(
      [balance("hsa", 1048.92, null), balance("ira", 100, -5)],
      () => ({ key: "hsa", label: "HSA" }),
    );
    expect(g).toMatchObject({
      move: null,
      noHoldings: { institutions: ["Voya Financial"], balance: -151.08 },
    });
    expect(noHoldingsTitle(g!.noHoldings!)).toBe(
      "Balance −$151.08; Voya sends no holdings, so market and deposits can't be split",
    );
    expect(
      noHoldingsTitle({ institutions: ["Voya Financial", "Ally"], balance: 5 }),
    ).toBe(
      "Balance +$5.00; Voya and Ally send no holdings, so market and deposits can't be split",
    );
  });

  it("true cash keeps its move of zero", () => {
    const [g] = groupCurrentBalances(
      [{ key: "cash", current: 500, market: false, move: null }],
      () => ({ key: "cash", label: "Cash" }),
    );
    expect(g).toMatchObject({ move: 0, noHoldings: null });
  });
});

describe("the accounts that send no holdings", () => {
  const unpriced = moves([row("hsa", [13])]);

  it("are named once, under the list, with their balance changes on hover", () => {
    expect(noHoldingsLine(unpriced)).toEqual({
      text: "Not in daily changes (no holdings): Voya HSA",
      detail:
        "These send balances but no holdings, so market moves and money paid in can't be split. Balance changes: Voya HSA Nov 5 −$151.08, Nov 4 +$200.00.",
    });
  });

  it("an account held in parts is named once, by its account's name", () => {
    const parts = [
      {
        performanceAccountId: 7,
        label: "Joint IRA (Vanguard) — Joanna — Traditional",
        account: "Joint IRA (Vanguard)",
        changed: [{ day: "2026-11-05", balance: 10 }],
      },
      {
        performanceAccountId: 7,
        label: "Joint IRA (Vanguard) — Joanna — Roth",
        account: "Joint IRA (Vanguard)",
        changed: [{ day: "2026-11-05", balance: 5.5 }],
      },
    ];
    const line = noHoldingsLine([...unpriced, ...parts]);
    expect(line?.text).toBe(
      "Not in daily changes (no holdings): Voya HSA and Joint IRA (Vanguard)",
    );
    expect(line?.detail).toContain("Joint IRA (Vanguard) Nov 5 +$15.50.");
  });

  it("none: no line", () => {
    expect(noHoldingsLine([])).toBeNull();
  });

  it("a close's own note never names one: it has only what that close is missing", () => {
    expect(
      missingNote({ day: "2026-11-05", missing: [] }, "2026-11-05", []),
    ).toBeNull();
    expect(
      missingNote(
        { day: "2026-11-04", missing: ["Fidelity"] },
        "2026-11-05",
        [],
      ),
    ).toBe("excludes Fidelity");
    expect(
      missingReason({ day: "2026-11-05", missing: [] }, "2026-11-05", []),
    ).toBeUndefined();
  });
});

// The rows add up to the card's total, with each group's move into its one close.
const groupRow = (
  key: string,
  current: number,
  move: number | null,
  market = true,
) => ({
  key,
  feedIds: [1],
  performanceAccountId: 1,
  current,
  snapshot: current,
  noSnapshot: false,
  source: "snapshot" as const,
  market,
  move,
});

describe("groupCurrentBalances", () => {
  const bucket = (b: { key: string }) =>
    b.key.startsWith("ira")
      ? { key: "ira", label: "IRA" }
      : b.key === "x"
        ? { key: "", label: "Not matched" }
        : { key: "401k", label: "401k" };

  it("rows add up to the total, largest first, unmatched last", () => {
    const rows = groupCurrentBalances(
      [
        groupRow("ira-a", 100, -5),
        groupRow("ira-b", 50, 2),
        groupRow("x", 500, 1),
        groupRow("401k", 300, 4),
      ],
      bucket,
    );
    expect(rows.map((r) => [r.label, r.current, r.move])).toEqual([
      ["401k", 300, 4],
      ["IRA", 150, -3],
      ["Not matched", 500, 1],
    ]);
  });

  it("a row with any move it can't tell shows none — never a partial sum", () => {
    const rows = groupCurrentBalances(
      [groupRow("ira-a", 100, -5), groupRow("ira-b", 50, null)],
      bucket,
    );
    expect(rows[0]!.move).toBeNull();
  });

  it("money that doesn't move with markets doesn't block the row", () => {
    const rows = groupCurrentBalances(
      [groupRow("ira-a", 100, -5), groupRow("ira-cash", 50, null, false)],
      bucket,
    );
    expect(rows[0]!.move).toBe(-5);
  });
});
