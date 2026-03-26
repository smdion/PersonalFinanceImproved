import { describe, it, expect } from "vitest";
import { GLOSSARY, getGlossaryEntry } from "@/lib/config/glossary";

describe("glossary", () => {
  it("exports all expected entries", () => {
    const keys = Object.keys(GLOSSARY);
    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(keys).toContain("brokerage");
    expect(keys).toContain("monteCarlo");
    expect(keys).toContain("irmaa");
    expect(keys).toContain("rmd");
    expect(keys).toContain("fireNumber");
  });

  it("every entry has required fields", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.label, `${key}.label`).toBeTruthy();
      expect(entry.plain, `${key}.plain`).toBeTruthy();
      expect(entry.description, `${key}.description`).toBeTruthy();
    }
  });

  it("some entries have learnMoreHref", () => {
    const withLinks = Object.values(GLOSSARY).filter((e) => e.learnMoreHref);
    expect(withLinks.length).toBeGreaterThan(0);
    for (const entry of withLinks) {
      expect(entry.learnMoreHref).toMatch(/^\//);
    }
  });

  it("getGlossaryEntry returns entry for valid key", () => {
    const entry = getGlossaryEntry("brokerage");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Brokerage");
  });

  it("getGlossaryEntry returns undefined for invalid key", () => {
    expect(getGlossaryEntry("nonexistent")).toBeUndefined();
  });
});
