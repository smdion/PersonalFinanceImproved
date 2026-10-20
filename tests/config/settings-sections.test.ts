import { describe, it, expect } from "vitest";
import {
  settingsHref,
  settingsLocationLabel,
} from "@/lib/config/settings-sections";

describe("settings links", () => {
  it("builds a tab + section link", () => {
    expect(settingsHref("integrations", "simplefin")).toBe(
      "/settings?tab=integrations&section=simplefin",
    );
    expect(settingsHref("general")).toBe("/settings?tab=general");
  });

  it("names the location the way the page shows it", () => {
    expect(settingsLocationLabel("taxdata", "limits")).toBe(
      "Settings → Reference Data → IRS Limits",
    );
    expect(settingsLocationLabel("integrations")).toBe(
      "Settings → Integrations",
    );
  });
});
