import { describe, it, expect } from "vitest";
import { recommendationsFromDataSources } from "@/lib/pure/recommendations-data";
import { evaluateDataSources } from "@/lib/pure/data-freshness";

describe("Keep data current recommendations", () => {
  it("lists only the sources the freshness check flagged", () => {
    const statuses = evaluateDataSources(
      {
        balance: { lastUpdated: "2026-01-02" },
        simplefin: { lastUpdated: "2026-10-12", error: null },
      },
      new Date("2026-10-13T12:00:00"),
    );
    const flagged = statuses.filter((s) => s.needsAttention);
    const recs = recommendationsFromDataSources(
      statuses,
      (s) => s.source.label,
    );
    expect(recs).toHaveLength(flagged.length);
    for (const r of recs) {
      expect(r).toMatchObject({
        area: "data",
        urgency: "soon",
        source: "ledgr",
        impact: null,
      });
      expect(r.id.startsWith("data:")).toBe(true);
    }
  });

  it("says when a source was never updated", () => {
    const recs = recommendationsFromDataSources(
      [
        {
          source: {
            key: "basis",
            label: "Basis",
            mode: "manual",
            rhythm: { kind: "days", days: 30 },
            rhythmLabel: "Monthly",
            href: "/tax-buckets",
          },
          lastUpdated: null,
          ageDays: null,
          needsAttention: true,
          reason: "Never entered",
        },
      ],
      (s) => s.source.label,
    );
    expect(recs).toEqual([
      expect.objectContaining({
        id: "data:basis",
        title: "Basis data",
        action: "Update Basis data — Never entered",
        context: "Never updated",
        href: "/tax-buckets",
      }),
    ]);
  });
});
