/**
 * RULES.md violations sweep (v0.5 expert-review M15).
 *
 * Static-string scan of src/ for the most common Data-Driven Architecture
 * violations enumerated in docs/RULES.md "Violations to Watch For":
 *
 *   1. Hardcoded category string equality (e.g., `=== '401k'`)
 *   2. Hardcoded category arrays (e.g., `['401k', '403b', 'hsa', 'ira', 'brokerage']`)
 *   3. parentCategory direct string comparison (use isPortfolioParent / isRetirementParent)
 *   4. taxType direct string comparison (use isTaxFree / config helpers)
 *
 * This is a deliberately lighter alternative to a full eslint-plugin-ledgr
 * (deferred to v0.5.x). Trade-off: it can't reason about types, only string
 * patterns. False positives are handled via an inline allowlist below.
 *
 * If you intentionally violate one of these patterns and have a documented
 * reason, add the file to the EXEMPT set with a comment.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = path.resolve(__dirname, "../../src");

// Files that legitimately use hardcoded categories. Each entry must include
// a reason. Adding to this list requires reviewer signoff.
const EXEMPT: Record<string, string> = {
  // The config FILE itself defines what categories exist.
  "src/lib/config/account-types.ts":
    "Defines ACCOUNT_TYPE_CONFIG and the predicate helpers",
  "src/lib/config/account-types.types.ts":
    "Type definitions for the config schema",
  "src/lib/config/enum-values.ts": "Exports the enum array for Zod validators",
  // Database schema files reference column names but the field name happens
  // to match a category — not a violation, just naming.
  "src/lib/db/schema-pg.ts": "Schema column definitions, not category logic",
  "src/lib/db/schema-sqlite.ts": "Auto-generated from schema-pg.ts",
  // The seed reference file is initialization data.
  "src/lib/db/seed-defaults.ts": "Seed data initializer",
};

const CATEGORY_VALUES = ["401k", "403b", "hsa", "ira", "brokerage"];

// ── File walker ─────────────────────────────────────────────────────

function* walkTsFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walkTsFiles(full);
    } else if (e.isFile() && /\.tsx?$/.test(e.name)) {
      yield full;
    }
  }
}

function relPath(abs: string): string {
  return path.relative(path.resolve(__dirname, "../.."), abs);
}

function isExempt(rel: string): boolean {
  return rel in EXEMPT;
}

function readFileLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf8").split("\n");
}

// ── Pattern checks ──────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

function findCategoryEqualityViolations(): Violation[] {
  const violations: Violation[] = [];
  const pattern = new RegExp(
    `(?:!==|===)\\s*['"](?:${CATEGORY_VALUES.join("|")})['"]`,
    "g",
  );
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (
        line.includes("lint-violation-ok") ||
        (i > 0 && lines[i - 1]!.includes("lint-violation-ok")) ||
        (i > 1 && lines[i - 2]!.includes("lint-violation-ok")) ||
        (i > 2 && lines[i - 3]!.includes("lint-violation-ok"))
      ) {
        continue;
      }
      // Inline escape hatch — author asserted this is intentional.
      // Format: `... // lint-violation-ok: <reason>`
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: "no-category-string-equality",
          snippet: trimmed.slice(0, 100),
        });
      }
      pattern.lastIndex = 0; // reset for the next line
    }
  }
  return violations;
}

function findHardcodedCategoryArrayViolations(): Violation[] {
  const violations: Violation[] = [];
  // Match an array literal that contains 3+ category strings (4+ would be
  // an obvious match against ALL categories; 3 still suspicious).
  const pattern = new RegExp(
    `\\[\\s*(?:['"](${CATEGORY_VALUES.join("|")})['"]\\s*,\\s*){2,}['"](${CATEGORY_VALUES.join("|")})['"]`,
  );
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (
        line.includes("lint-violation-ok") ||
        (i > 0 && lines[i - 1]!.includes("lint-violation-ok")) ||
        (i > 1 && lines[i - 2]!.includes("lint-violation-ok")) ||
        (i > 2 && lines[i - 3]!.includes("lint-violation-ok"))
      ) {
        continue;
      }
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: "no-hardcoded-category-array",
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

function findParentCategoryStringEqualityViolations(): Violation[] {
  const violations: Violation[] = [];
  const pattern =
    /parentCategory\s*(?:===|!==)\s*["'](?:Retirement|Portfolio)["']/;
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (
        line.includes("lint-violation-ok") ||
        (i > 0 && lines[i - 1]!.includes("lint-violation-ok")) ||
        (i > 1 && lines[i - 2]!.includes("lint-violation-ok")) ||
        (i > 2 && lines[i - 3]!.includes("lint-violation-ok"))
      ) {
        continue;
      }
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: "no-parent-category-string-equality",
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

function findTaxTypeStringEqualityViolations(): Violation[] {
  const violations: Violation[] = [];
  const pattern =
    /taxType\s*(?:===|!==)\s*["'](?:preTax|taxFree|hsa|afterTax|roth|traditional)["']/;
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (
        line.includes("lint-violation-ok") ||
        (i > 0 && lines[i - 1]!.includes("lint-violation-ok")) ||
        (i > 1 && lines[i - 2]!.includes("lint-violation-ok")) ||
        (i > 2 && lines[i - 3]!.includes("lint-violation-ok"))
      ) {
        continue;
      }
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: "no-tax-type-string-equality",
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

// ── Tests ───────────────────────────────────────────────────────────

function formatViolations(label: string, violations: Violation[]): string {
  if (violations.length === 0) return "";
  return (
    `\n${label} (${violations.length}):\n` +
    violations.map((v) => `  ${v.file}:${v.line}\n    ${v.snippet}`).join("\n")
  );
}

describe("RULES.md violations sweep", () => {
  it("no hardcoded category string equality (=== '401k', etc.)", () => {
    const violations = findCategoryEqualityViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} category-string-equality violations. ` +
          `Use the predicates in src/lib/config/account-types.ts (isInLimit401kGroup, ` +
          `tracksCostBasis, etc.) instead of comparing strings directly.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no hardcoded category arrays (['401k', '403b', ...])", () => {
    const violations = findHardcodedCategoryArrayViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hardcoded-category-array violations. ` +
          `Use getAllCategories() / categoriesWithIrsLimit() / similar from ` +
          `src/lib/config/account-types.ts.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no parentCategory direct string equality (use isPortfolioParent / isRetirementParent)", () => {
    const violations = findParentCategoryStringEqualityViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} parentCategory-string-equality violations. ` +
          `Use isPortfolioParent() / isRetirementParent() from account-types.ts.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no taxType direct string equality (use isTaxFree / config predicates)", () => {
    const violations = findTaxTypeStringEqualityViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} taxType-string-equality violations. ` +
          `Use isTaxFree() and config predicates from account-types.ts.\n` +
          formatViolations("Violations", violations),
      );
    }
  });
});
