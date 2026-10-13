import { describe, it, expect } from "vitest";
import {
  applyDismissals,
  nextDismissals,
  parseDismissals,
  snoozeUntil,
} from "@/lib/pure/recommendation-dismissals";
import type { Recommendation } from "@/lib/pure/recommendations";

const rec = (
  id: string,
  urgency: Recommendation["urgency"] = "soon",
): Recommendation => ({
  id,
  area: "paycheck",
  urgency,
  title: id,
  action: id,
  context: "",
  impact: null,
  href: "/",
  source: "moneyGuy",
});

describe("recommendation dismissals", () => {
  it("hides dismissed and still-snoozed recommendations", () => {
    const { shown, dismissed } = applyDismissals(
      [rec("a"), rec("b"), rec("c"), rec("d")],
      {
        a: { until: null, urgency: "soon" },
        b: { until: "2026-12-01", urgency: "soon" },
        c: { until: "2026-10-01", urgency: "soon" }, // snooze over
      },
      "2026-10-13",
    );
    expect(shown.map((r) => r.id)).toEqual(["c", "d"]);
    expect(dismissed.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("brings one back when it escalates to urgent", () => {
    const { shown } = applyDismissals(
      [rec("a", "now")],
      { a: { until: null, urgency: "soon" } },
      "2026-10-13",
    );
    expect(shown.map((r) => r.id)).toEqual(["a"]);
  });

  it("writes drop expired snoozes and apply the change", () => {
    expect(
      nextDismissals(
        {
          old: { until: "2026-01-01", urgency: "soon" },
          keep: { until: null, urgency: "now" },
          gone: { until: null, urgency: "soon" },
        },
        "2026-10-13",
        { id: "gone", value: null },
      ),
    ).toEqual({ keep: { until: null, urgency: "now" } });
    expect(
      nextDismissals({}, "2026-10-13", {
        id: "x",
        value: { until: "2027-01-13", urgency: "soon" },
      }),
    ).toEqual({ x: { until: "2027-01-13", urgency: "soon" } });
  });

  it("snoozes by calendar months and reads bad data as none", () => {
    expect(snoozeUntil("2026-10-13", 3)).toBe("2027-01-13");
    expect(parseDismissals({ a: { until: "soon", urgency: "now" } })).toEqual(
      {},
    );
    expect(parseDismissals(null)).toEqual({});
  });
});
