import { describe, it, expect } from "vitest";
import { recentChanges } from "@/lib/pure/recent-change";

const h = (...rows: [string, number][]) =>
  rows.map(([day, balance]) => ({ day, balance }));

describe("recentChanges", () => {
  const a = h(
    ["2026-10-10", 100],
    ["2026-10-16", 150],
    ["2026-10-16", 160], // two syncs that day: the last one counts
    ["2026-10-17", 170],
  );
  const b = h(["2026-10-12", 50], ["2026-10-17", 40]);

  it("latest day's last balance vs the last on or before day − N, summed", () => {
    const [d1, d7] = recentChanges([a, b], [1, 7]);
    // 1 day: a 170−160, b 40−50 (its last on/before 10-16 is 10-12)
    expect(d1).toEqual({ days: 1, change: 0, since: "2026-10-12" });
    // 7 days (on/before 10-10): b has no balance that early → not covered
    expect(d7).toEqual({ days: 7, change: null, since: null });
  });

  it("covered once every feed reaches back; since = earliest base day", () => {
    expect(recentChanges([a], [7])).toEqual([
      { days: 7, change: 70, since: "2026-10-10" },
    ]);
  });

  it("feeds with no history are ignored; none at all → not covered", () => {
    expect(recentChanges([a, []], [1])[0]!.change).toBe(10);
    expect(recentChanges([], [1])[0]!.change).toBeNull();
  });
});
