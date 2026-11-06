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
  alwaysExcludedLine,
  missingNote,
  missingReason,
  splitUnpriced,
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
        label: "Voya HSA",
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

describe("the daily total's note", () => {
  const unpriced = moves([row("hsa", [13])]);

  it("excludes the account by name, market-only", () => {
    const c = { day: "2026-11-05", missing: [] };
    expect(missingNote(c, "2026-11-05", [], unpriced)).toBe(
      "excludes Voya HSA (no holdings)",
    );
    expect(missingReason(c, "2026-11-05", [], unpriced)).toBe(
      "Voya HSA sends no holdings, so its market move can't be told and isn't in this total.",
    );
  });

  it("joins the other notes", () => {
    const c = { day: "2026-11-04", missing: ["Fidelity"] };
    expect(missingNote(c, "2026-11-05", [], unpriced)).toBe(
      "excludes Fidelity · excludes Voya HSA (no holdings)",
    );
  });

  it("a close its balance didn't change into says nothing of it", () => {
    expect(
      missingNote(
        { day: "2026-11-03", missing: [] },
        "2026-11-05",
        [],
        unpriced,
      ),
    ).toBeNull();
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

describe("an exclusion on every close shown is said once", () => {
  const hsa = {
    label: "Joanna HSA (Voya)",
    changed: [
      { day: "2026-11-05", balance: -151.08 },
      { day: "2026-11-04", balance: 200 },
    ],
  };
  const cash = {
    label: "Ally Cash",
    changed: [{ day: "2026-11-04", balance: 12 }],
  };
  const closes = [{ day: "2026-11-05" }, { day: "2026-11-04" }];

  it("out of every line: one line under the list, none per line", () => {
    const { always, varying } = splitUnpriced(closes, [hsa]);
    expect(alwaysExcludedLine(always)).toBe(
      "Excludes Joanna HSA (Voya): no holdings reported",
    );
    expect(
      missingNote(
        { day: "2026-11-05", missing: [] },
        "2026-11-05",
        [],
        varying,
      ),
    ).toBeNull();
  });

  it("several such accounts are joined", () => {
    const both = { ...cash, changed: hsa.changed };
    const { always } = splitUnpriced(closes, [hsa, both]);
    expect(alwaysExcludedLine(always)).toBe(
      "Excludes Joanna HSA (Voya) and Ally Cash: no holdings reported",
    );
  });

  it("out of some lines only: stays on those lines", () => {
    const { always, varying } = splitUnpriced(closes, [hsa, cash]);
    expect(always).toEqual([hsa]);
    expect(varying).toEqual([cash]);
    expect(
      missingNote(
        { day: "2026-11-04", missing: [] },
        "2026-11-05",
        [],
        varying,
      ),
    ).toBe("excludes Ally Cash (no holdings)");
    expect(
      missingNote(
        { day: "2026-11-05", missing: [] },
        "2026-11-05",
        [],
        varying,
      ),
    ).toBeNull();
  });

  it("nothing excluded, or no closes: no line", () => {
    expect(alwaysExcludedLine(splitUnpriced(closes, []).always)).toBeNull();
    expect(splitUnpriced([], [hsa]).always).toEqual([]);
  });
});
