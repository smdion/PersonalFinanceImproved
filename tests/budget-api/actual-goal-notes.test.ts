import { describe, it, expect } from "vitest";
import { mergeGoalIntoNote } from "@/lib/budget-api/actual-goal-notes";

describe("mergeGoalIntoNote", () => {
  describe("fixed shape (#template <amount>)", () => {
    it("appends a fresh template when there's no existing note", () => {
      const result = mergeGoalIntoNote(null, "fixed", 250);
      expect(result).toEqual({ ok: true, note: "#template 250" });
    });

    it("appends a fresh template preserving existing free-text note content", () => {
      const result = mergeGoalIntoNote("Rent — due on the 1st", "fixed", 250);
      expect(result).toEqual({
        ok: true,
        note: "Rent — due on the 1st\n#template 250",
      });
    });

    it("replaces just the amount when a matching template already exists", () => {
      const result = mergeGoalIntoNote(
        "Groceries\n#template 100",
        "fixed",
        150,
      );
      expect(result).toEqual({ ok: true, note: "Groceries\n#template 150" });
    });

    it("formats a whole-dollar amount without decimals", () => {
      const result = mergeGoalIntoNote(null, "fixed", 250);
      expect(result.ok && result.note).toBe("#template 250");
    });

    it("formats a fractional amount to 2 decimal places", () => {
      const result = mergeGoalIntoNote(null, "fixed", 150.5);
      expect(result.ok && result.note).toBe("#template 150.50");
    });

    it("does not match (and reports conflict against) a target-balance shape", () => {
      const result = mergeGoalIntoNote("#template up to 500", "fixed", 250);
      expect(result.ok).toBe(false);
    });

    it("reports conflict against a percentage template, without altering it", () => {
      const result = mergeGoalIntoNote(
        "#template 10% of Paycheck",
        "fixed",
        250,
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("reports conflict against a priority-suffixed template", () => {
      const result = mergeGoalIntoNote("#template-1 100", "fixed", 250);
      expect(result.ok).toBe(false);
    });

    it("reports conflict against a by-date template", () => {
      const result = mergeGoalIntoNote(
        "#template 10000 by 2025-12",
        "fixed",
        250,
      );
      expect(result.ok).toBe(false);
    });

    it("is case-insensitive when matching an existing tag", () => {
      const result = mergeGoalIntoNote("#Template 100", "fixed", 150);
      expect(result).toEqual({ ok: true, note: "#template 150" });
    });
  });

  describe("target-balance shape (#template up to <amount>)", () => {
    it("appends a fresh 'up to' template when there's no existing note", () => {
      const result = mergeGoalIntoNote(null, "target-balance", 5000);
      expect(result).toEqual({ ok: true, note: "#template up to 5000" });
    });

    it("replaces just the amount when a matching 'up to' template already exists", () => {
      const result = mergeGoalIntoNote(
        "#template up to 4000",
        "target-balance",
        5000,
      );
      expect(result).toEqual({ ok: true, note: "#template up to 5000" });
    });

    it("does not match (and reports conflict against) a bare fixed-amount shape", () => {
      const result = mergeGoalIntoNote("#template 100", "target-balance", 5000);
      expect(result.ok).toBe(false);
    });
  });

  describe("undefined/empty note handling", () => {
    it("treats undefined the same as no note", () => {
      const result = mergeGoalIntoNote(undefined, "fixed", 100);
      expect(result).toEqual({ ok: true, note: "#template 100" });
    });

    it("treats an empty string the same as no note", () => {
      const result = mergeGoalIntoNote("", "fixed", 100);
      expect(result).toEqual({ ok: true, note: "#template 100" });
    });

    it("treats a whitespace-only note the same as no note (no leading blank line)", () => {
      const result = mergeGoalIntoNote("   \n  ", "fixed", 100);
      expect(result).toEqual({ ok: true, note: "#template 100" });
    });
  });
});
