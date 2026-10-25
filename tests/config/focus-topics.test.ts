/** Every focus link is built from one table (lib/config/focus-topics). */
import { describe, it, expect } from "vitest";
import {
  FOCUS_HOMES,
  FOCUS_STATE,
  focusHref,
  parseFocusIds,
} from "@/lib/config/focus-topics";

describe("focusHref", () => {
  it("one param for every page, plus the topic's one id", () => {
    expect(focusHref({ topic: "earlyAccess" })).toBe(
      "/tax-buckets?focus=earlyAccess",
    );
    expect(focusHref({ topic: "projectionYear", year: 2047 })).toBe(
      "/retirement?focus=projectionYear&focusId=2047",
    );
  });

  it("Settings keeps its own link scheme", () => {
    expect(
      focusHref({
        topic: "settings",
        tab: "integrations",
        section: "simplefin",
      }),
    ).toBe("/settings?tab=integrations&section=simplefin");
  });

  it("an id round-trips; a bad one is rejected", () => {
    expect(parseFocusIds("projectionYear", "2047")).toEqual({ year: 2047 });
    expect(parseFocusIds("projectionYear", "x")).toBeNull();
    expect(parseFocusIds("projectionYear", null)).toBeNull();
    expect(parseFocusIds("planHealth", null)).toEqual({});
  });
});

describe("FOCUS_HOMES", () => {
  it("every state a topic sets is a value its page knows", () => {
    for (const [topic, home] of Object.entries(FOCUS_HOMES))
      for (const [key, value] of Object.entries(home.state ?? {}))
        expect(
          (
            FOCUS_STATE[key as keyof typeof FOCUS_STATE] as readonly string[]
          ).includes(value as string),
          `${topic}.${key}=${value}`,
        ).toBe(true);
  });
});
