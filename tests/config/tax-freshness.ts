/**
 * Tax Freshness — expiration-aware test utilities.
 *
 * Tax parameters have known validity windows. This utility lets tests declare
 * "these values are valid through tax year YYYY" and produces warnings or
 * failures when parameters may be stale.
 *
 * Usage:
 *   taxFreshness("IRMAA brackets", { validThrough: 2026, source: "CMS-2026-01234" });
 *
 * Behavior by staleness:
 *   - Current or future year → passes silently
 *   - 1 year past → warning (test passes but logs a notice)
 *   - 2+ years past → test failure with update instructions
 */

import { expect } from "vitest";

/** Get current tax year (calendar year; use next year after October since IRS publishes ahead). */
export function currentTaxYear(): number {
  const now = new Date();
  return now.getFullYear();
}

type FreshnessLevel = "current" | "warning" | "expired";

export type TaxFreshnessEntry = {
  /** Human-readable name of the parameter set. */
  name: string;
  /** Last tax year these values were verified against IRS/SSA/CMS publications. */
  validThrough: number;
  /** IRS Notice, Revenue Procedure, or other citation. */
  source: string;
  /** Where to find updated values. */
  updateUrl?: string;
  /** Where in the codebase this parameter lives. */
  location: string;
  /** How often this typically changes. */
  changeFrequency: "annual" | "rarely" | "legislative-only";
};

function getFreshnessLevel(validThrough: number): FreshnessLevel {
  const year = currentTaxYear();
  if (validThrough >= year) return "current";
  if (validThrough === year - 1) return "warning";
  return "expired";
}

/**
 * Assert that a tax parameter set is still fresh.
 * - Current: passes silently
 * - Warning (1 year stale): passes but logs a warning
 * - Expired (2+ years stale): fails the test with update instructions
 */
export function assertTaxFreshness(entry: TaxFreshnessEntry): void {
  const level = getFreshnessLevel(entry.validThrough);
  const year = currentTaxYear();

  if (level === "expired") {
    expect.fail(
      `TAX DATA EXPIRED: "${entry.name}" was last verified for tax year ${entry.validThrough} ` +
        `(now ${year}, ${year - entry.validThrough} years stale).\n` +
        `  Source: ${entry.source}\n` +
        `  Location: ${entry.location}\n` +
        `  Update from: ${entry.updateUrl ?? "See TAX-PARAMETER-RUNBOOK.md"}\n` +
        `  Action: Update the values and change validThrough to ${year}.`,
    );
  }

  if (level === "warning") {
    console.warn(
      `⚠ TAX DATA WARNING: "${entry.name}" was verified for tax year ${entry.validThrough}. ` +
        `Current year is ${year}. Check if ${year} values have been published.\n` +
        `  Source: ${entry.source}\n` +
        `  Location: ${entry.location}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registry — all tax parameters that need freshness tracking
// ---------------------------------------------------------------------------

/**
 * Central registry of every tax parameter set in the codebase with its
 * validity window, source citation, and update location.
 *
 * When updating a parameter: bump validThrough, update source, and verify
 * the values match the IRS/SSA/CMS publication.
 */
export const TAX_PARAMETER_REGISTRY: TaxFreshnessEntry[] = [
  // --- DB-driven (annual, updated via seed file or Settings UI) ---
  //
  // The tax-data file's yearly tables (withholding brackets, limits,
  // deductions, LTCG) are one entry: `pnpm check:tax-params` and
  // tax-data-file.test.ts check each individually on every run, so this is
  // a once-a-year "I checked this" attestation. IRMAA and the ACA poverty
  // levels keep their own entries (different publishers and timing).
  {
    name: "Tax-data file (brackets, limits, deductions, LTCG)",
    validThrough: 2026,
    source:
      "IRS Publication 15-T (2025/2026); IRS Notice 2025-67; IRS Revenue Procedure 2025-32",
    updateUrl: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
    location:
      "tax-data/us-federal/ (tax_brackets, contribution_limits, ltcg_brackets) — verified structurally by `pnpm check:tax-params`",
    changeFrequency: "annual",
  },
  {
    name: "IRMAA brackets (seed)",
    validThrough: 2026,
    source: "CMS 2026 projected thresholds",
    updateUrl: "https://www.cms.gov/newsroom/fact-sheets",
    location: "tax-data/us-federal/ → irmaa_brackets",
    changeFrequency: "annual",
  },
  {
    name: "ACA Federal Poverty Level",
    // `validThrough` names the COVERAGE year -- NOT the HHS publication
    // year. Per 26 CFR
    // §1.36B-1(h), a coverage year's PTC eligibility uses the guidelines
    // HHS published the PRIOR calendar year, so this table's actual
    // source data was published in (validThrough - 1).
    validThrough: 2026,
    source:
      "HHS Federal Register (guidelines published 2025, for 2026 coverage)",
    updateUrl:
      "https://aspe.hhs.gov/topics/poverty-economic-mobility/hhs-poverty-guidelines",
    location: "tax-data/us-federal/ → fpl_by_household",
    changeFrequency: "annual",
  },
  // (The "ACA premium estimates" entry was removed along with
  // its dead `estimateAcaSubsidyValue` function — see aca-tables.ts.)

  // --- Structurally stable (rarely change) ---
  {
    name: "SS taxation thresholds",
    validThrough: 2026,
    source: "IRC §86 — unchanged since 1993, not indexed",
    location: "src/lib/config/ss-tax.ts → SS_TAX_THRESHOLDS",
    changeFrequency: "legislative-only",
  },
  {
    name: "RMD Uniform Lifetime Table",
    validThrough: 2026,
    source: "IRS Publication 590-B, Table III (updated 2022)",
    updateUrl: "https://www.irs.gov/publications/p590b",
    location: "src/lib/config/rmd-tables.ts → UNIFORM_LIFETIME_TABLE",
    changeFrequency: "legislative-only",
  },
  {
    name: "RMD start age rules (SECURE 2.0)",
    validThrough: 2026,
    source: "SECURE 2.0 Act §107 (2022)",
    location: "src/lib/config/rmd-tables.ts → getRmdStartAge()",
    changeFrequency: "legislative-only",
  },
  {
    name: "FICA rates (SS 6.2%, Medicare 1.45%, surtax 0.9%)",
    validThrough: 2026,
    source:
      "IRC §3101 — SS rate unchanged since 1990, Medicare surtax since 2013",
    location: "tax-data/us-federal/ → contribution_limits (fica_*)",
    changeFrequency: "legislative-only",
  },
  {
    name: "Medicare surtax threshold ($200k/$250k)",
    validThrough: 2026,
    source: "IRC §3101(b)(2) — not indexed to inflation",
    location: "tax-data/us-federal/ → fica_medicare_surtax_threshold",
    changeFrequency: "legislative-only",
  },
  {
    name: "NIIT thresholds ($200k/$250k) and rate (3.8%)",
    validThrough: 2026,
    source: "IRC §1411 — not indexed to inflation (ACA 2013)",
    location: "src/lib/config/niit.ts → NIIT_THRESHOLDS, NIIT_RATE",
    changeFrequency: "legislative-only",
  },
];
