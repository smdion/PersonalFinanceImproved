import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { GLOSSARY, getGlossaryEntry } from "@/lib/config/glossary";

describe("glossary", () => {
  it("every entry has required fields", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.label, `${key}.label`).toBeTruthy();
      expect(entry.plain, `${key}.plain`).toBeTruthy();
      expect(entry.description, `${key}.description`).toBeTruthy();
    }
  });

  it("every learn-more link points at a real page", () => {
    const appDir = path.resolve("src/app/(dashboard)");
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      if (!entry.learnMoreHref) continue;
      const page = path.join(appDir, entry.learnMoreHref, "page.tsx");
      expect(fs.existsSync(page), `${key} → ${entry.learnMoreHref}`).toBe(true);
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
