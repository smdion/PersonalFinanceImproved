/**
 * The Current Balances card's rows: the same figures as its total, by
 * group, with each group's move dated by the close it ends at.
 */
import { describe, it, expect } from "vitest";
import { groupCurrentBalances } from "@/components/cards/dashboard/linked-balance-card";

const balance = (
  key: string,
  feedIds: number[],
  current: number,
  snapshot: number,
  noSnapshot = false,
) => ({
  key,
  feedIds,
  performanceAccountId: 1,
  current,
  snapshot,
  comparable: true,
  noSnapshot,
});

const move = (feedId: number, day: string, m: number) => ({
  feedId,
  day,
  fromDay: "2026-10-28",
  move: m,
  flows: 0,
});

describe("groupCurrentBalances", () => {
  const bucket = (b: { key: string }) =>
    b.key.startsWith("ira")
      ? { key: "ira", label: "IRA" }
      : b.key === "x"
        ? { key: "", label: "Not matched" }
        : { key: "401k", label: "401k" };

  it("rows add up to the total, with change since the snapshot", () => {
    const rows = groupCurrentBalances(
      [
        balance("ira-a", [1], 100, 90),
        balance("ira-b", [2], 50, 50),
        balance("401k", [3], 300, 310),
      ],
      [],
      bucket,
    );
    expect(rows.map((r) => [r.label, r.current, r.since])).toEqual([
      ["401k", 300, -10],
      ["IRA", 150, 10],
    ]);
    expect(rows.reduce((t, r) => t + r.current, 0)).toBe(450);
  });

  it("each row's move keeps the closes it's from; money outside the snapshot isn't a change", () => {
    const rows = groupCurrentBalances(
      [
        balance("ira-a", [1], 100, 90),
        balance("ira-b", [2], 50, 50),
        balance("x", [4], 25, 0, true),
      ],
      [
        move(1, "2026-10-30", -5),
        move(2, "2026-10-29", 2),
        move(4, "2026-10-30", 1),
      ],
      bucket,
    );
    expect(rows[0]).toMatchObject({
      label: "IRA",
      move: -3,
      days: ["2026-10-29", "2026-10-30"],
    });
    expect(rows.at(-1)).toMatchObject({
      label: "Not matched",
      since: null,
      move: 1,
    });
  });
});
