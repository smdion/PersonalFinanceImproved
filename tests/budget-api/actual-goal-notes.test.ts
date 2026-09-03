import { describe, it, expect } from "vitest";
import {
  mergeGoalIntoNote,
  parseGoalFromNote,
} from "@/lib/budget-api/actual-goal-notes";

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

  // A negative amount used to write
  // `#template -50`, which FIXED_RE/TARGET_BALANCE_RE (digits-only, no
  // sign) can never match again -- every later write for that category
  // permanently fell into the ANY_TEMPLATE_RE "conflict" branch instead.
  describe("negative amount rejection", () => {
    it("rejects a negative fixed amount instead of writing malformed syntax", () => {
      const result = mergeGoalIntoNote(null, "fixed", -50);
      expect(result.ok).toBe(false);
    });

    it("rejects a negative target-balance amount instead of writing malformed syntax", () => {
      const result = mergeGoalIntoNote(null, "target-balance", -50);
      expect(result.ok).toBe(false);
    });

    it("does not clobber an existing note when rejecting a negative amount", () => {
      const result = mergeGoalIntoNote("Rent — due on the 1st", "fixed", -50);
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("zero or positive"),
      });
    });

    it("accepts zero (not negative) as a valid amount", () => {
      const result = mergeGoalIntoNote(null, "fixed", 0);
      expect(result).toEqual({ ok: true, note: "#template 0" });
    });

    it("regression guard: a rejected negative amount can't poison a later valid write for the same category", () => {
      const rejected = mergeGoalIntoNote(null, "fixed", -50);
      expect(rejected.ok).toBe(false);
      // Nothing was ever written to the note, so a subsequent real write
      // for the same category starts clean, not fighting a malformed
      // "#template -50" line stuck in ANY_TEMPLATE_RE limbo.
      const accepted = mergeGoalIntoNote(null, "fixed", 50);
      expect(accepted).toEqual({ ok: true, note: "#template 50" });
    });
  });
});

// Found live, 2026-09-01: a push-preview screen showed every linked
// category's "current" value as $0 and its full new amount as the delta,
// even for categories that had already been pushed successfully. Root
// cause: actual-client.ts read `goalTarget` from Actual's structured
// (write-inaccessible) `goal` field, which `mergeGoalIntoNote`'s write
// path never touches -- the two never agreed. `parseGoalFromNote` is the
// read counterpart that actually matches what gets written.
describe("parseGoalFromNote", () => {
  describe("fixed shape", () => {
    it("extracts the amount from a bare fixed template", () => {
      expect(parseGoalFromNote("#template 250", "fixed")).toBe(250);
    });

    it("extracts a fractional amount", () => {
      expect(parseGoalFromNote("#template 150.50", "fixed")).toBe(150.5);
    });

    it("extracts the amount alongside other free-text note content", () => {
      expect(
        parseGoalFromNote("Rent — due on the 1st\n#template 250", "fixed"),
      ).toBe(250);
    });

    it("is case-insensitive, matching mergeGoalIntoNote's own write behavior", () => {
      expect(parseGoalFromNote("#Template 100", "fixed")).toBe(100);
    });

    it("returns undefined when there's no template at all", () => {
      expect(
        parseGoalFromNote("Just a note, no goal here", "fixed"),
      ).toBeUndefined();
      expect(parseGoalFromNote(null, "fixed")).toBeUndefined();
      expect(parseGoalFromNote(undefined, "fixed")).toBeUndefined();
    });

    it("returns undefined for a target-balance template when asked for fixed shape -- doesn't guess across shapes", () => {
      expect(
        parseGoalFromNote("#template up to 5000", "fixed"),
      ).toBeUndefined();
    });

    it("returns undefined for any other template shape (percentage, priority, by-date) -- same 'don't guess' contract as mergeGoalIntoNote", () => {
      expect(
        parseGoalFromNote("#template 10% of Paycheck", "fixed"),
      ).toBeUndefined();
      expect(parseGoalFromNote("#template-1 100", "fixed")).toBeUndefined();
      expect(
        parseGoalFromNote("#template 10000 by 2025-12", "fixed"),
      ).toBeUndefined();
    });
  });

  describe("target-balance shape", () => {
    it("extracts the amount from an 'up to' template", () => {
      expect(parseGoalFromNote("#template up to 5000", "target-balance")).toBe(
        5000,
      );
    });

    it("returns undefined for a bare fixed template when asked for target-balance shape", () => {
      expect(
        parseGoalFromNote("#template 100", "target-balance"),
      ).toBeUndefined();
    });
  });

  // The property this whole fix depends on: whatever mergeGoalIntoNote
  // just wrote, parseGoalFromNote must read back exactly, for both
  // shapes and across repeated writes (matching-shape amount replacement).
  describe("round-trips with mergeGoalIntoNote (the write path this reads back)", () => {
    it("reads back a fresh fixed write", () => {
      const written = mergeGoalIntoNote(null, "fixed", 450);
      expect(written.ok).toBe(true);
      const note = written.ok ? written.note : "";
      expect(parseGoalFromNote(note, "fixed")).toBe(450);
    });

    it("reads back a fresh target-balance write", () => {
      const written = mergeGoalIntoNote(null, "target-balance", 12000);
      expect(written.ok).toBe(true);
      const note = written.ok ? written.note : "";
      expect(parseGoalFromNote(note, "target-balance")).toBe(12000);
    });

    it("reads back the updated amount after a second write replaces the first", () => {
      const first = mergeGoalIntoNote(null, "fixed", 100);
      const firstNote = first.ok ? first.note : "";
      const second = mergeGoalIntoNote(firstNote, "fixed", 175.25);
      expect(second.ok).toBe(true);
      const secondNote = second.ok ? second.note : "";
      expect(parseGoalFromNote(secondNote, "fixed")).toBe(175.25);
    });

    it("reads back correctly when the write preserved existing free-text content", () => {
      const written = mergeGoalIntoNote("Rent — due on the 1st", "fixed", 250);
      const note = written.ok ? written.note : "";
      expect(parseGoalFromNote(note, "fixed")).toBe(250);
    });
  });
});
