import { describe, it, expect } from "vitest";
import {
  stripInstitutionSuffix,
  personDisplayName,
  formatCurrency,
  formatPercent,
  formatDate,
  compactCurrency,
  formatNumber,
  buildAccountLabel,
  accountDisplayName,
} from "@/lib/utils/format";

/**
 * Display formatter tests (v0.5.x test backfill).
 *
 * Every currency, percent, date, and account name in the UI flows through
 * this module. It was previously excluded from the coverage `include` list
 * because "many helpers lack direct tests" — this file closes the gap so a
 * regression in any formatter fails loudly at CI instead of silently
 * rendering wrong numbers across the app.
 */

describe("stripInstitutionSuffix", () => {
  it("strips a balanced paren group at the end of the label", () => {
    expect(stripInstitutionSuffix("Alice 401k (Fidelity)")).toBe("Alice 401k");
    expect(stripInstitutionSuffix("IRA (Vanguard)")).toBe("IRA");
  });

  it("strips surrounding whitespace before the paren group", () => {
    expect(stripInstitutionSuffix("Bob HSA   (HSA Bank)")).toBe("Bob HSA");
  });

  it("leaves the label alone when there is no trailing paren group", () => {
    expect(stripInstitutionSuffix("Alice 401k")).toBe("Alice 401k");
    expect(stripInstitutionSuffix("")).toBe("");
  });

  it("only strips the trailing group, not inner parens", () => {
    expect(stripInstitutionSuffix("James (Patricia) 401k (Vanguard)")).toBe(
      "James (Patricia) 401k",
    );
  });
});

describe("personDisplayName", () => {
  const peopleMap = new Map<number, string>([
    [1, "Alice"],
    [2, "Bob"],
  ]);

  it("returns the matching person name", () => {
    expect(personDisplayName(1, peopleMap)).toBe("Alice");
    expect(personDisplayName(2, peopleMap)).toBe("Bob");
  });

  it("returns 'Joint' for null or undefined owner id", () => {
    expect(personDisplayName(null, peopleMap)).toBe("Joint");
    expect(personDisplayName(undefined, peopleMap)).toBe("Joint");
  });

  it("throws for an unknown id (orphan FK is a data-integrity error, not a display problem)", () => {
    expect(() => personDisplayName(99, peopleMap)).toThrow(
      /people\.id=99 not found/,
    );
  });
});

describe("formatCurrency", () => {
  it("formats positive values with exactly 2 decimal places", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negative values with a leading minus", () => {
    expect(formatCurrency(-1234.5)).toBe("-$1,234.50");
    expect(formatCurrency(-0.01)).toBe("-$0.01");
  });

  it("rounds to 2 decimals (banker's rounding via Intl)", () => {
    expect(formatCurrency(1.005)).toMatch(/\$1\.0[01]/);
    expect(formatCurrency(1.995)).toMatch(/\$(1\.99|2\.00)/);
  });
});

describe("formatPercent", () => {
  it("converts a decimal to a percent string with 0 decimals by default", () => {
    expect(formatPercent(0.15)).toBe("15%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("respects the decimals argument", () => {
    expect(formatPercent(0.2189, 2)).toBe("21.89%");
    expect(formatPercent(0.12345, 1)).toBe("12.3%");
    expect(formatPercent(0.5, 3)).toBe("50.000%");
  });

  it("handles negative values", () => {
    expect(formatPercent(-0.1)).toBe("-10%");
  });
});

describe("formatDate", () => {
  it("formats a YYYY-MM-DD string with the 'short' preset as Month Year", () => {
    expect(formatDate("2026-01-15", "short")).toBe("Jan 2026");
    expect(formatDate("2026-12-31", "short")).toBe("Dec 2026");
  });

  it("formats with the 'medium' preset as Mon D, YYYY", () => {
    expect(formatDate("2026-01-05", "medium")).toBe("Jan 5, 2026");
    expect(formatDate("2026-06-15", "medium")).toBe("Jun 15, 2026");
  });

  it("formats with the 'default' preset as locale MM/DD/YYYY", () => {
    // en-US locale — "1/5/2026"
    expect(formatDate("2026-01-05")).toMatch(/1\/5\/2026/);
  });

  it("does not shift the date across timezones for date-only strings", () => {
    // Regression guard: "2026-01-01" parsed as UTC midnight would become
    // 2025-12-31 in negative-offset locales. The function appends
    // T00:00:00 to avoid this.
    expect(formatDate("2026-01-01", "medium")).toBe("Jan 1, 2026");
  });

  it("accepts a Date object directly", () => {
    const d = new Date(2026, 0, 15); // Jan 15, 2026 (local)
    expect(formatDate(d, "short")).toBe("Jan 2026");
  });

  it("accepts ISO strings with a time component without double-appending", () => {
    expect(formatDate("2026-03-15T12:00:00.000Z", "short")).toBe("Mar 2026");
  });
});

describe("compactCurrency", () => {
  it("formats values under 1k with no suffix", () => {
    expect(compactCurrency(0)).toBe("$0");
    expect(compactCurrency(500)).toBe("$500");
    expect(compactCurrency(999)).toBe("$999");
  });

  it("formats thousands with a 'k' suffix and zero decimals", () => {
    expect(compactCurrency(1000)).toBe("$1k");
    expect(compactCurrency(45_000)).toBe("$45k");
    expect(compactCurrency(999_999)).toBe("$1000k");
  });

  it("formats millions with an 'M' suffix and one decimal", () => {
    expect(compactCurrency(1_000_000)).toBe("$1.0M");
    expect(compactCurrency(1_500_000)).toBe("$1.5M");
    expect(compactCurrency(12_345_678)).toBe("$12.3M");
  });

  it("prefixes negative values with a minus sign", () => {
    expect(compactCurrency(-500)).toBe("-$500");
    expect(compactCurrency(-45_000)).toBe("-$45k");
    expect(compactCurrency(-1_500_000)).toBe("-$1.5M");
  });
});

describe("formatNumber", () => {
  it("adds commas to thousands", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(999)).toBe("999");
  });

  it("respects the decimals argument", () => {
    expect(formatNumber(1234.5678, 2)).toBe("1,234.57");
    expect(formatNumber(0.1, 4)).toBe("0.1000");
  });

  it("handles negative values", () => {
    expect(formatNumber(-1234567)).toBe("-1,234,567");
  });
});

describe("buildAccountLabel", () => {
  it("builds 'Owner Type (Institution)' for a basic account", () => {
    expect(
      buildAccountLabel({
        ownerName: "Alice",
        accountType: "401k",
        institution: "Fidelity",
      }),
    ).toBe("Alice 401k (Fidelity)");
  });

  it("uses the config display label for proper casing (hsa → HSA)", () => {
    expect(
      buildAccountLabel({
        ownerName: "Alice",
        accountType: "hsa",
        institution: "HSA Bank",
      }),
    ).toBe("Alice HSA (HSA Bank)");
  });

  it("includes a custom label between owner and type", () => {
    expect(
      buildAccountLabel({
        accountType: "brokerage",
        label: "Long Term",
        institution: "Vanguard",
      }),
    ).toBe("Long Term Brokerage (Vanguard)");
  });

  it("omits the owner when not provided (joint accounts)", () => {
    expect(
      buildAccountLabel({
        accountType: "ira",
        institution: "Vanguard",
      }),
    ).toBe("IRA (Vanguard)");
  });
});

describe("accountDisplayName", () => {
  it("prefers a user-set displayName over everything else", () => {
    expect(
      accountDisplayName({
        displayName: "My Favorite Account",
        accountLabel: "Alice 401k (Fidelity)",
        accountType: "401k",
        institution: "Fidelity",
      }),
    ).toBe("My Favorite Account");
  });

  it("falls back to accountLabel when no displayName is set", () => {
    expect(
      accountDisplayName({
        accountLabel: "Alice 401k (Fidelity)",
      }),
    ).toBe("Alice 401k (Fidelity)");
  });

  it("rebuilds the label with an owner prefix when one is provided and the stored label does not include it", () => {
    // Two spouses each have a 401k at Fidelity; the stored label is generic.
    // Calling with an owner name should disambiguate.
    const result = accountDisplayName(
      {
        accountLabel: "401k (Fidelity)",
        accountType: "401k",
        institution: "Fidelity",
      },
      "Bob",
    );
    expect(result).toBe("Bob 401k (Fidelity)");
  });

  it("keeps the stored label as-is when it already starts with the owner name", () => {
    expect(
      accountDisplayName(
        {
          accountLabel: "Alice 401k (Fidelity)",
          accountType: "401k",
          institution: "Fidelity",
        },
        "Alice",
      ),
    ).toBe("Alice 401k (Fidelity)");
  });

  it("constructs on the fly from type + institution when no label is stored", () => {
    expect(
      accountDisplayName(
        {
          accountType: "ira",
          institution: "Vanguard",
        },
        "Alice",
      ),
    ).toBe("Alice IRA (Vanguard)");
  });

  it("uses the config display label as a last resort when only accountType is present", () => {
    expect(
      accountDisplayName(
        {
          accountType: "hsa",
        },
        "Alice",
      ),
    ).toBe("Alice HSA");
  });

  it("returns 'Unknown' for a completely empty account object", () => {
    expect(accountDisplayName({})).toBe("Unknown");
  });

  it("routes the last-resort fallback through getDisplayConfig rather than the raw key", () => {
    // The config's displayLabel for "401k" happens to match the raw key,
    // but for types like "hsa" → "HSA" the lookup matters. Verify the
    // lookup path is taken for a type where casing differs.
    expect(accountDisplayName({ accountType: "hsa" })).toBe("HSA");
  });
});
