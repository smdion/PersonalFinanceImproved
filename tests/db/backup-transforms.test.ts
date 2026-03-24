import { describe, it, expect } from "vitest";
import {
  transformBackupToCurrentSchema,
  KNOWN_SCHEMA_VERSIONS,
} from "@/lib/db/backup-transforms";

const CURRENT_VERSION = "0000_v2_initial_schema"; // v0.2.0 squashed

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal backup table set for testing. */
function makeBackup(overrides?: Record<string, unknown[]>) {
  return {
    annual_performance: [],
    account_performance: [],
    retirement_salary_overrides: [],
    retirement_budget_overrides: [],
    retirement_settings: [],
    contribution_accounts: [],
    savings_goals: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Current version — no transform
// ---------------------------------------------------------------------------

describe("transformBackupToCurrentSchema — current version", () => {
  it("returns tables unchanged when versions match", () => {
    const tables = makeBackup({
      savings_goals: [{ id: 1, is_api_sync_enabled: false }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      CURRENT_VERSION,
      CURRENT_VERSION,
    );
    expect(result.transformed).toBe(false);
    expect(result.tables).toBe(tables); // same reference, no clone
  });
});

// ---------------------------------------------------------------------------
// Unknown version — rejected
// ---------------------------------------------------------------------------

describe("transformBackupToCurrentSchema — unknown version", () => {
  it("throws for an unknown schema version", () => {
    expect(() =>
      transformBackupToCurrentSchema(
        makeBackup(),
        "9999_future_version",
        CURRENT_VERSION,
      ),
    ).toThrow(/Unknown schema version/);
  });

  it("error message includes the unknown version", () => {
    expect(() =>
      transformBackupToCurrentSchema(
        makeBackup(),
        "9999_future_version",
        CURRENT_VERSION,
      ),
    ).toThrow("9999_future_version");
  });
});

// ---------------------------------------------------------------------------
// v0.1.x → v0.2.0 transforms
// ---------------------------------------------------------------------------

describe("transformBackupToCurrentSchema — v0.1.x to v0.2.0", () => {
  // ---- 0002: annual_performance category rename ----

  it("renames 'Retirement' to '401k/IRA' in annual_performance for pre-0002 backups", () => {
    const tables = makeBackup({
      annual_performance: [
        { id: 1, category: "Retirement" },
        { id: 2, category: "Brokerage" },
      ],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0001_drop_pg_enums",
      CURRENT_VERSION,
    );
    expect(result.transformed).toBe(true);
    expect(result.tables.annual_performance).toEqual([
      expect.objectContaining({ id: 1, category: "401k/IRA" }),
      expect.objectContaining({ id: 2, category: "Brokerage" }),
    ]);
  });

  it("does NOT rename category for post-0002 backups", () => {
    const tables = makeBackup({
      annual_performance: [{ id: 1, category: "Retirement" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0003_add_rollovers_column",
      CURRENT_VERSION,
    );
    // Should NOT be renamed because 0003 >= 0002
    expect(
      (result.tables.annual_performance![0] as Record<string, unknown>)
        .category,
    ).toBe("Retirement");
  });

  // ---- 0003: rollovers column ----

  it("adds rollovers column with default '0' for pre-0003 backups", () => {
    const tables = makeBackup({
      account_performance: [{ id: 1, contributions: "100" }],
      annual_performance: [{ id: 1, contributions: "200" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0002_rename_retirement_category",
      CURRENT_VERSION,
    );
    expect(
      (result.tables.account_performance![0] as Record<string, unknown>)
        .rollovers,
    ).toBe("0");
    expect(
      (result.tables.annual_performance![0] as Record<string, unknown>)
        .rollovers,
    ).toBe("0");
  });

  it("does not overwrite existing rollovers column", () => {
    const tables = makeBackup({
      account_performance: [{ id: 1, rollovers: "500" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0002_rename_retirement_category",
      CURRENT_VERSION,
    );
    expect(
      (result.tables.account_performance![0] as Record<string, unknown>)
        .rollovers,
    ).toBe("500");
  });

  // ---- 0005: contribution_profile_id ----

  it("adds contribution_profile_id null for pre-0005 backups", () => {
    const tables = makeBackup({
      retirement_salary_overrides: [{ id: 1, new_salary: "100000" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0004_ambiguous_wraith",
      CURRENT_VERSION,
    );
    expect(
      (result.tables.retirement_salary_overrides![0] as Record<string, unknown>)
        .contribution_profile_id,
    ).toBeNull();
  });

  // ---- 0006: audit columns ----

  it("adds created_by/updated_by null for pre-0006 backups", () => {
    const tables = makeBackup({
      retirement_budget_overrides: [{ id: 1, amount: "5000" }],
      retirement_salary_overrides: [{ id: 1, new_salary: "100000" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0005_cold_random",
      CURRENT_VERSION,
    );

    const budgetOverride = result.tables
      .retirement_budget_overrides![0] as Record<string, unknown>;
    expect(budgetOverride.created_by).toBeNull();
    expect(budgetOverride.updated_by).toBeNull();

    const salaryOverride = result.tables
      .retirement_salary_overrides![0] as Record<string, unknown>;
    expect(salaryOverride.created_by).toBeNull();
    expect(salaryOverride.updated_by).toBeNull();
  });

  // ---- 0007: filing_status ----

  it("adds filing_status null for pre-0007 backups", () => {
    const tables = makeBackup({
      retirement_settings: [{ id: 1, retirement_age: 65 }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0006_goofy_rawhide_kid",
      CURRENT_VERSION,
    );
    expect(
      (result.tables.retirement_settings![0] as Record<string, unknown>)
        .filing_status,
    ).toBeNull();
  });

  // ---- 0008: prior-year contribution columns ----

  it("adds prior_year_contrib columns for pre-0008 backups", () => {
    const tables = makeBackup({
      contribution_accounts: [{ id: 1, account_type: "ira" }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0007_melted_swordsman",
      CURRENT_VERSION,
    );
    const account = result.tables.contribution_accounts![0] as Record<
      string,
      unknown
    >;
    expect(account.prior_year_contrib_amount).toBe("0");
    expect(account.prior_year_contrib_year).toBeNull();
  });

  // ---- v0.2.0: boolean column renames ----

  it("renames api_sync_enabled to is_api_sync_enabled in savings_goals", () => {
    const tables = makeBackup({
      savings_goals: [
        { id: 1, api_sync_enabled: true },
        { id: 2, api_sync_enabled: false },
      ],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0008_prior_year_contrib",
      CURRENT_VERSION,
    );
    const goals = result.tables.savings_goals! as Record<string, unknown>[];
    expect(goals[0]!.is_api_sync_enabled).toBe(true);
    expect(goals[0]!).not.toHaveProperty("api_sync_enabled");
    expect(goals[1]!.is_api_sync_enabled).toBe(false);
  });

  it("renames lt_brokerage_enabled to is_lt_brokerage_enabled in retirement_settings", () => {
    const tables = makeBackup({
      retirement_settings: [{ id: 1, lt_brokerage_enabled: true }],
    });
    const result = transformBackupToCurrentSchema(
      tables,
      "0008_prior_year_contrib",
      CURRENT_VERSION,
    );
    const settings = result.tables.retirement_settings![0] as Record<
      string,
      unknown
    >;
    expect(settings.is_lt_brokerage_enabled).toBe(true);
    expect(settings).not.toHaveProperty("lt_brokerage_enabled");
  });
});

// ---------------------------------------------------------------------------
// Full cumulative transform from earliest version
// ---------------------------------------------------------------------------

describe("transformBackupToCurrentSchema — full cumulative from 0000", () => {
  it("applies ALL transforms for a v0.1.0 initial backup", () => {
    const tables = makeBackup({
      annual_performance: [{ id: 1, category: "Retirement" }],
      account_performance: [{ id: 1, contributions: "100" }],
      retirement_salary_overrides: [{ id: 1, new_salary: "100000" }],
      retirement_budget_overrides: [{ id: 1, amount: "5000" }],
      retirement_settings: [
        { id: 1, retirement_age: 65, lt_brokerage_enabled: true },
      ],
      contribution_accounts: [{ id: 1, account_type: "ira" }],
      savings_goals: [{ id: 1, api_sync_enabled: true }],
    });

    const result = transformBackupToCurrentSchema(
      tables,
      "0000_initial_schema",
      CURRENT_VERSION,
    );

    expect(result.transformed).toBe(true);

    // Category rename
    expect(
      (result.tables.annual_performance![0] as Record<string, unknown>)
        .category,
    ).toBe("401k/IRA");

    // Rollovers added
    expect(
      (result.tables.account_performance![0] as Record<string, unknown>)
        .rollovers,
    ).toBe("0");

    // Salary overrides: profile_id + audit cols
    const salaryOverride = result.tables
      .retirement_salary_overrides![0] as Record<string, unknown>;
    expect(salaryOverride.contribution_profile_id).toBeNull();
    expect(salaryOverride.created_by).toBeNull();
    expect(salaryOverride.updated_by).toBeNull();

    // Budget overrides: audit cols
    const budgetOverride = result.tables
      .retirement_budget_overrides![0] as Record<string, unknown>;
    expect(budgetOverride.created_by).toBeNull();
    expect(budgetOverride.updated_by).toBeNull();

    // Retirement settings: filing_status + boolean rename
    const settings = result.tables.retirement_settings![0] as Record<
      string,
      unknown
    >;
    expect(settings.filing_status).toBeNull();
    expect(settings.is_lt_brokerage_enabled).toBe(true);
    expect(settings).not.toHaveProperty("lt_brokerage_enabled");

    // Contribution accounts: prior-year columns
    const account = result.tables.contribution_accounts![0] as Record<
      string,
      unknown
    >;
    expect(account.prior_year_contrib_amount).toBe("0");
    expect(account.prior_year_contrib_year).toBeNull();

    // Savings goals: boolean rename
    const goal = result.tables.savings_goals![0] as Record<string, unknown>;
    expect(goal.is_api_sync_enabled).toBe(true);
    expect(goal).not.toHaveProperty("api_sync_enabled");
  });
});

// ---------------------------------------------------------------------------
// Every known version is transformable
// ---------------------------------------------------------------------------

describe("KNOWN_SCHEMA_VERSIONS completeness", () => {
  it("every known version transforms without error", () => {
    for (const version of KNOWN_SCHEMA_VERSIONS) {
      const tables = makeBackup();
      // Should not throw
      const result = transformBackupToCurrentSchema(
        tables,
        version,
        CURRENT_VERSION,
      );
      expect(result.transformed).toBe(true);
      expect(result.sourceVersion).toBe(version);
    }
  });

  it("known versions list contains the expected v0.1.x tags", () => {
    expect(KNOWN_SCHEMA_VERSIONS).toContain("0000_initial_schema");
    expect(KNOWN_SCHEMA_VERSIONS).toContain("0008_prior_year_contrib");
    expect(KNOWN_SCHEMA_VERSIONS.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Data isolation — transform doesn't mutate original
// ---------------------------------------------------------------------------

describe("transform immutability", () => {
  it("does not mutate the original tables object", () => {
    const original = {
      savings_goals: [{ id: 1, api_sync_enabled: true }],
    };
    const originalJson = JSON.stringify(original);

    transformBackupToCurrentSchema(
      original,
      "0008_prior_year_contrib",
      CURRENT_VERSION,
    );

    expect(JSON.stringify(original)).toBe(originalJson);
  });
});

// ---------------------------------------------------------------------------
// Empty/missing tables handled gracefully
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles empty tables object", () => {
    const result = transformBackupToCurrentSchema(
      {},
      "0008_prior_year_contrib",
      CURRENT_VERSION,
    );
    expect(result.transformed).toBe(true);
    expect(Object.keys(result.tables)).toHaveLength(0);
  });

  it("handles tables with empty arrays", () => {
    const tables = makeBackup(); // all arrays are empty
    const result = transformBackupToCurrentSchema(
      tables,
      "0000_initial_schema",
      CURRENT_VERSION,
    );
    expect(result.transformed).toBe(true);
  });

  it("handles tables not in VERSION_TABLE_NAMES gracefully", () => {
    const tables = {
      some_unknown_table: [{ foo: "bar" }],
      savings_goals: [{ id: 1, api_sync_enabled: false }],
    };
    const result = transformBackupToCurrentSchema(
      tables,
      "0008_prior_year_contrib",
      CURRENT_VERSION,
    );
    // Unknown table preserved as-is
    expect(result.tables.some_unknown_table).toEqual([{ foo: "bar" }]);
    // Known table transformed
    expect(
      (result.tables.savings_goals![0] as Record<string, unknown>)
        .is_api_sync_enabled,
    ).toBe(false);
  });
});
