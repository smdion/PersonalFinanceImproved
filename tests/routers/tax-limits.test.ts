/**
 * Tax limits router tests — CRUD for contributionLimits, taxBrackets,
 * ltcgBrackets, and irmaaBrackets.
 *
 * Each test uses its own createTestCaller() to get a fresh isolated DB,
 * avoiding conflicts with pre-seeded migration data.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import { createTestCaller, adminSession } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// CONTRIBUTION LIMITS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.contributionLimits", () => {
  it("list returns an array", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const rows = await caller.settings.contributionLimits.list();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("create inserts a contribution limit and returns it", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.contributionLimits.create({
        taxYear: 2099,
        limitType: "test_limit_type",
        value: "23500",
      });
      expect(result).toBeDefined();
      expect(result!.taxYear).toBe(2099);
      expect(result!.limitType).toBe("test_limit_type");
      expect(result!.value).toBe("23500");
    } finally {
      cleanup();
    }
  });

  it("created limit appears in list", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.contributionLimits.create({
        taxYear: 2098,
        limitType: "unique_type",
        value: "5000",
      });
      const rows = await caller.settings.contributionLimits.list();
      const found = rows.find((r: { id: number }) => r.id === created!.id);
      expect(found).toBeDefined();
      expect(found!.value).toBe("5000");
    } finally {
      cleanup();
    }
  });

  it("create with notes stores them", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.contributionLimits.create({
        taxYear: 2099,
        limitType: "ira_traditional",
        value: "7000",
        notes: "Standard IRA limit",
      });
      expect(result!.notes).toBe("Standard IRA limit");
    } finally {
      cleanup();
    }
  });

  it("update changes the value", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.contributionLimits.create({
        taxYear: 2099,
        limitType: "hsa_update_test",
        value: "8300",
      });
      const updated = await caller.settings.contributionLimits.update({
        id: created!.id,
        taxYear: 2099,
        limitType: "hsa_update_test",
        value: "8550",
      });
      expect(updated!.value).toBe("8550");
    } finally {
      cleanup();
    }
  });

  it("delete removes the row", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.contributionLimits.create({
        taxYear: 2099,
        limitType: "delete_me",
        value: "999",
      });
      await caller.settings.contributionLimits.delete({ id: created!.id });
      const rows = await caller.settings.contributionLimits.list();
      const found = rows.find((r: { id: number }) => r.id === created!.id);
      expect(found).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rejects invalid taxYear below 2000", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.contributionLimits.create({
          taxYear: 1999,
          limitType: "test",
          value: "100",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects non-numeric value string", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.contributionLimits.create({
          taxYear: 2099,
          limitType: "test",
          value: "abc",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TAX BRACKETS
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0.1 },
  { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
  { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
];

describe("settings.taxBrackets", () => {
  it("list returns an array", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const rows = await caller.settings.taxBrackets.list();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("create inserts brackets and returns the row", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      // Use a year unlikely to conflict with seed data
      const result = await caller.settings.taxBrackets.create({
        taxYear: 2099,
        filingStatus: "MFJ",
        w4Checkbox: false,
        brackets: SAMPLE_BRACKETS,
      });
      expect(result).toBeDefined();
      expect(result!.taxYear).toBe(2099);
      expect(result!.filingStatus).toBe("MFJ");
    } finally {
      cleanup();
    }
  });

  it("update changes the brackets data", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.taxBrackets.create({
        taxYear: 2098,
        filingStatus: "HOH",
        w4Checkbox: true,
        brackets: SAMPLE_BRACKETS,
      });
      const newBrackets = [
        { threshold: 0, baseWithholding: 0, rate: 0.1 },
        { threshold: 50000, baseWithholding: 5000, rate: 0.22 },
      ];
      const updated = await caller.settings.taxBrackets.update({
        id: created!.id,
        taxYear: 2098,
        filingStatus: "HOH",
        w4Checkbox: true,
        brackets: newBrackets,
      });
      expect(updated).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("delete removes the row", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.taxBrackets.create({
        taxYear: 2097,
        filingStatus: "Single",
        w4Checkbox: false,
        brackets: SAMPLE_BRACKETS,
      });
      await caller.settings.taxBrackets.delete({ id: created!.id });
      const rows = await caller.settings.taxBrackets.list();
      const found = rows.find((r: { id: number }) => r.id === created!.id);
      expect(found).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rejects invalid filing status", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.taxBrackets.create({
          taxYear: 2099,
          // @ts-expect-error — testing invalid input
          filingStatus: "InvalidStatus",
          w4Checkbox: false,
          brackets: SAMPLE_BRACKETS,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LTCG BRACKETS
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_LTCG = [
  { threshold: 0, rate: 0 },
  { threshold: 94050, rate: 0.15 },
  { threshold: null, rate: 0.2 },
];

describe("settings.ltcgBrackets", () => {
  it("list returns an array", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const rows = await caller.settings.ltcgBrackets.list();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("create inserts LTCG brackets", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.ltcgBrackets.create({
        taxYear: 2099,
        filingStatus: "MFJ",
        brackets: SAMPLE_LTCG,
      });
      expect(result).toBeDefined();
      expect(result!.taxYear).toBe(2099);
    } finally {
      cleanup();
    }
  });

  it("update changes LTCG brackets", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.ltcgBrackets.create({
        taxYear: 2098,
        filingStatus: "Single",
        brackets: [
          { threshold: 0, rate: 0 },
          { threshold: null, rate: 0.15 },
        ],
      });
      const updated = await caller.settings.ltcgBrackets.update({
        id: created!.id,
        taxYear: 2098,
        filingStatus: "Single",
        brackets: [
          { threshold: 0, rate: 0 },
          { threshold: 50000, rate: 0.15 },
          { threshold: null, rate: 0.2 },
        ],
      });
      expect(updated).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("delete removes the row", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.ltcgBrackets.create({
        taxYear: 2097,
        filingStatus: "HOH",
        brackets: SAMPLE_LTCG,
      });
      await caller.settings.ltcgBrackets.delete({ id: created!.id });
      const rows = await caller.settings.ltcgBrackets.list();
      const found = rows.find((r: { id: number }) => r.id === created!.id);
      expect(found).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IRMAA BRACKETS
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_IRMAA = [
  { magiThreshold: 0, annualSurcharge: 0 },
  { magiThreshold: 206000, annualSurcharge: 2092 },
  { magiThreshold: 258000, annualSurcharge: 5232 },
];

describe("settings.irmaaBrackets", () => {
  it("list returns an array", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const rows = await caller.settings.irmaaBrackets.list();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("create inserts IRMAA brackets", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.irmaaBrackets.create({
        taxYear: 2099,
        filingStatus: "MFJ",
        brackets: SAMPLE_IRMAA,
      });
      expect(result).toBeDefined();
      expect(result!.taxYear).toBe(2099);
    } finally {
      cleanup();
    }
  });

  it("update changes IRMAA brackets", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.irmaaBrackets.create({
        taxYear: 2098,
        filingStatus: "Single",
        brackets: SAMPLE_IRMAA,
      });
      const updated = await caller.settings.irmaaBrackets.update({
        id: created!.id,
        taxYear: 2098,
        filingStatus: "Single",
        brackets: [
          { magiThreshold: 0, annualSurcharge: 0 },
          { magiThreshold: 103000, annualSurcharge: 1046 },
        ],
      });
      expect(updated).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("delete removes the row", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const created = await caller.settings.irmaaBrackets.create({
        taxYear: 2097,
        filingStatus: "HOH",
        brackets: SAMPLE_IRMAA,
      });
      await caller.settings.irmaaBrackets.delete({ id: created!.id });
      const rows = await caller.settings.irmaaBrackets.list();
      const found = rows.find((r: { id: number }) => r.id === created!.id);
      expect(found).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rejects invalid filing status", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.irmaaBrackets.create({
          taxYear: 2099,
          // @ts-expect-error — testing invalid input
          filingStatus: "BadStatus",
          brackets: SAMPLE_IRMAA,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
