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
  {
    name: "Federal tax brackets (seed)",
    validThrough: 2026,
    source: "IRS Publication 15-T (2025/2026)",
    updateUrl: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
    location: "seed-reference-data.sql → tax_brackets",
    changeFrequency: "annual",
  },
  {
    name: "Contribution limits (seed)",
    validThrough: 2026,
    source: "IRS Notice 2025-67",
    updateUrl: "https://www.irs.gov/newsroom/401k-limit-increases",
    location: "seed-reference-data.sql → contribution_limits",
    changeFrequency: "annual",
  },
  {
    name: "LTCG brackets (seed)",
    validThrough: 2026,
    source: "IRS Revenue Procedure 2025-32",
    updateUrl:
      "https://www.irs.gov/newsroom/irs-provides-tax-inflation-adjustments",
    location: "seed-reference-data.sql → ltcg_brackets",
    changeFrequency: "annual",
  },
  {
    name: "IRMAA brackets (seed)",
    validThrough: 2026,
    source: "CMS 2026 projected thresholds",
    updateUrl: "https://www.cms.gov/newsroom/fact-sheets",
    location: "seed-reference-data.sql → irmaa_brackets",
    changeFrequency: "annual",
  },

  // --- Code fallbacks (should match latest seed data) ---
  {
    name: "LTCG bracket fallback (code)",
    validThrough: 2026,
    source: "IRS Revenue Procedure 2025-32",
    updateUrl:
      "https://www.irs.gov/newsroom/irs-provides-tax-inflation-adjustments",
    location: "src/lib/config/tax-tables.ts → LTCG_BRACKETS",
    changeFrequency: "annual",
  },
  {
    name: "IRMAA bracket fallback (code)",
    validThrough: 2026,
    source: "CMS 2026 projected thresholds",
    updateUrl: "https://www.cms.gov/newsroom/fact-sheets",
    location: "src/lib/config/irmaa-tables.ts → IRMAA_BRACKETS",
    changeFrequency: "annual",
  },
  {
    name: "ACA Federal Poverty Level",
    validThrough: 2026,
    source: "HHS Federal Register (2026 projected)",
    updateUrl:
      "https://aspe.hhs.gov/topics/poverty-economic-mobility/hhs-poverty-guidelines",
    location: "src/lib/config/aca-tables.ts → FPL_BY_HOUSEHOLD",
    changeFrequency: "annual",
  },
  {
    name: "ACA premium estimates",
    validThrough: 2026,
    source: "National average benchmark estimates (2026 projected)",
    location: "src/lib/config/aca-tables.ts → estimateAcaSubsidyValue()",
    changeFrequency: "annual",
  },

  // --- Structurally stable (rarely change) ---
  {
    name: "SS taxation thresholds",
    validThrough: 2026,
    source: "IRC §86 — unchanged since 1993, not indexed",
    location:
      "src/lib/calculators/engine/tax-estimation.ts → SS_TAX_THRESHOLDS",
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
    location: "seed-reference-data.sql → contribution_limits (fica_*)",
    changeFrequency: "legislative-only",
  },
  {
    name: "Medicare surtax threshold ($200k/$250k)",
    validThrough: 2026,
    source: "IRC §3101(b)(2) — not indexed to inflation",
    location: "seed-reference-data.sql → fica_medicare_surtax_threshold",
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
