/**
 * The Current Balances card's rows: the same figures as its total, by
 * group, with each group's move into the card's one close.
 */
import { describe, it, expect } from "vitest";
import { groupCurrentBalances } from "@/components/cards/dashboard/linked-balance-card";

const balance = (
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
        balance("ira-a", 100, -5),
        balance("ira-b", 50, 2),
        balance("x", 500, 1),
        balance("401k", 300, 4),
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
      [balance("ira-a", 100, -5), balance("ira-b", 50, null)],
      bucket,
    );
    expect(rows[0]!.move).toBeNull();
  });

  it("money that doesn't move with markets doesn't block the row", () => {
    const rows = groupCurrentBalances(
      [balance("ira-a", 100, -5), balance("ira-cash", 50, null, false)],
      bucket,
    );
    expect(rows[0]!.move).toBe(-5);
  });
});
