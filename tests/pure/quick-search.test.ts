import { describe, it, expect } from "vitest";
import { searchPages, type SearchEntry } from "@/lib/pure/quick-search";

const entries: SearchEntry[] = [
  {
    href: "/paycheck",
    label: "Paycheck",
    group: "Cash Flow",
    keywords: ["salary", "bonus"],
  },
  {
    href: "/contributions",
    label: "Contributions",
    group: "Insights",
    keywords: ["hsa", "401k", "limits"],
  },
  {
    href: "/settings",
    label: "Settings",
    group: "System",
    keywords: ["irs limits", "hsa"],
  },
];

describe("searchPages", () => {
  it("matches labels, groups and keywords; every word must match", () => {
    expect(searchPages(entries, "hsa limits").map((e) => e.href)).toEqual([
      "/contributions",
      "/settings",
    ]);
    expect(searchPages(entries, "bonus").map((e) => e.href)).toEqual([
      "/paycheck",
    ]);
    expect(searchPages(entries, "insights").map((e) => e.href)).toEqual([
      "/contributions",
    ]);
    expect(searchPages(entries, "nothing here")).toEqual([]);
  });

  it("ranks label prefixes first and lists everything for an empty query", () => {
    expect(searchPages(entries, "set")[0]!.href).toBe("/settings");
    expect(searchPages(entries, "  ")).toHaveLength(3);
  });
});
