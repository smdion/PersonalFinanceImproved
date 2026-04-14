/**
 * RULES.md violations sweep.
 *
 * Static-string scan of src/ for the Data-Driven Architecture violations
 * enumerated in docs/RULES.md § "Violations to Watch For". Each rule pairs
 * with a numbered bullet in that section.
 *
 * Checked rules:
 *    1. Hardcoded category string equality (e.g., `=== '401k'`)
 *    2. Hardcoded category arrays (e.g., `['401k', '403b', 'hsa', 'ira', 'brokerage']`)
 *    3. parentCategory direct string comparison (use isPortfolioParent / isRetirementParent)
 *    4. taxType direct string comparison (use isTaxFree / config helpers)
 *    5. displayName ?? accountLabel inline fallback (use accountDisplayName())
 *    6. Direct .accountLabel read in JSX (.tsx) for display (use accountDisplayName())
 *    7. Hardcoded performance category strings ("401k/IRA", "HSA", "Brokerage")
 *    8. useState with hardcoded account type ("401k", "ira", etc.)
 *    9. Inline `.toFixed(N) + "%"` instead of formatPercent()
 *   10. Mutation using `z.string()` for `accountType` instead of `z.enum(accountCategoryEnum())`
 *   11. Absolute imports from engine internals instead of the barrel
 *
 * Intentionally NOT checked (needs semantic analysis, not string matching):
 *   - "Router computing budget expenses with different column index" (#1)
 *   - "Page showing salary not from getCurrentSalary()" (#2)
 *   - "Fallback value silently replacing missing data" (#3)
 *   - "Two routers fetching same data independently" (#4)
 *   - "What-if override leaking into non-scenario calculations" (#5)
 *   - "Metric computed via different code paths on different pages" (#6)
 *   - "Router using getLatestSnapshot() for year-level data" (#7)
 *   - "Procedure computing mortgage/cash/salary independently" (#8)
 *   - "Tax location derived from config instead of stored data" (#9)
 *   - "Local label map duplicating config" (#11) — false-positive prone
 *   - "New account type requiring code changes beyond config entry" (#13) — review-only
 *   - "Appending (Owner) suffix separately" (#15) — too many ways to write it
 *   - "Snapshot rows flat instead of grouped" (#17)
 *   - "Sub-row showing raw accountType instead of subType" (#18)
 *   - "Owner name on every sub-row" (#19)
 *   - "New financial logic in engine/projection.ts" (#20) — review-only
 *   - "Override logic inline instead of override-resolution.ts" (#22)
 *   - "Balance manipulation without balance-utils/deduction" (#23)
 *   - "Hardcoded category sort order" (#27)
 *   - "z.string() for financial amounts" (#30) — context-dependent
 *   - "Helper calling new Date() internally" (#32) — context-dependent
 *   - "UI permission check not matching router procedure type" (#33)
 *   - "API route bypassing DEMO_ONLY" (#34)
 *   - "Numeric fallback 0.04 / 0.07 / 200000" (#35) — too noisy
 *   - "Stored computed values without sync/cascade" (#36) — review-only
 *
 * This is a deliberately lighter alternative to a full eslint-plugin-ledgr
 * (deferred to v0.5.x). Trade-off: it can't reason about types, only string
 * patterns. False positives are handled via an inline allowlist below or
 * the `// lint-violation-ok: <reason>` escape hatch on the flagged line
 * (or up to 3 lines above).
 *
 * If you intentionally violate one of these patterns and have a documented
 * reason, add the file to the EXEMPT set with a comment OR add the inline
 * escape hatch comment.
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

// Shared walker: runs `pattern` against every non-comment line of every
// non-exempt .ts/.tsx file under src/, honors the `// lint-violation-ok`
// escape hatch, and yields violations tagged with the given rule name.
// Optional filter restricts to a specific extension.
function findPatternViolations(
  pattern: RegExp,
  ruleName: string,
  options: {
    additionalExempt?: Set<string>;
    filterExt?: ".ts" | ".tsx";
  } = {},
): Violation[] {
  const violations: Violation[] = [];
  const { additionalExempt, filterExt } = options;
  for (const file of walkTsFiles(SRC_DIR)) {
    if (filterExt && !file.endsWith(filterExt)) continue;
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    if (additionalExempt?.has(rel)) continue;
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
      // Reset global regex state per line
      if (pattern.global) pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: ruleName,
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

// Rule 5: `displayName ?? accountLabel` inline fallback — use accountDisplayName().
function findDisplayNameAccountLabelFallbackViolations(): Violation[] {
  return findPatternViolations(
    /\bdisplayName\s*\?\?\s*[A-Za-z_$][\w$]*\.accountLabel\b/,
    "no-display-name-accountlabel-fallback",
  );
}

// Rule 6: direct `.accountLabel` read in .tsx (JSX) files — use accountDisplayName().
// The helper itself (`src/lib/utils/format.ts`) legitimately reads this field,
// but format.ts is a .ts file so the .tsx filter naturally excludes it.
// `performance.ts` router writes the column — also excluded by extension filter.
function findDirectAccountLabelReadViolations(): Violation[] {
  return findPatternViolations(
    /\.accountLabel\b/,
    "no-direct-account-label-read",
    { filterExt: ".tsx" },
  );
}

// Rule 7: hardcoded performance category strings used as bracket-index keys —
// import the PERF_CATEGORY_* constant from display-labels.ts instead.
//
// Only matches `x["Retirement"]` or `x?.["Retirement"]` patterns (real drift).
// Does NOT match `parentCategory: "Retirement"` (object property value —
// legitimate canonical usage), `title="Retirement"` (JSX prop), `| "Retirement"`
// (type union), or `"Retirement"` inside comments. Those are all legitimate
// uses of the canonical string values.
function findHardcodedPerfCategoryViolations(): Violation[] {
  const pattern =
    /\??\.?\[\s*["'](?:401k\/IRA|HSA|Brokerage|Retirement|Portfolio)["']\s*\]/;
  return findPatternViolations(pattern, "no-hardcoded-perf-category-bracket", {
    additionalExempt: new Set(["src/lib/config/display-labels.ts"]),
  });
}

// Rule 8: `useState("401k")` or other hardcoded account-type defaults.
function findHardcodedAccountTypeStateViolations(): Violation[] {
  return findPatternViolations(
    new RegExp(
      `\\buseState\\s*(?:<[^>]*>)?\\s*\\(\\s*["'](?:${CATEGORY_VALUES.join("|")})["']`,
    ),
    "no-hardcoded-account-type-state",
  );
}

// Rule 9: inline `.toFixed(N) + "%"` or template concatenation instead of
// formatPercent(). Looks for `.toFixed(` followed shortly by `%` on the
// same line, or a backtick template with `%` after a computed expression.
function findInlinePercentFormatViolations(): Violation[] {
  // .toFixed(X) + "%"  |  .toFixed(X)}%` in a template
  const pattern =
    /\.toFixed\(\d+\)\s*(?:\+\s*["']%["']|\}\s*%\s*`|\s*,\s*["']%["'])/;
  return findPatternViolations(pattern, "no-inline-percent-format", {
    additionalExempt: new Set([
      // The format helper itself implements the conversion.
      "src/lib/utils/format.ts",
    ]),
  });
}

// Rule 10: mutation using `z.string()` for `accountType` field. Looks for
// `accountType: z.string(` — should be `z.enum(accountCategoryEnum())`.
function findAccountTypeZStringViolations(): Violation[] {
  return findPatternViolations(
    /\baccountType\s*:\s*z\.string\b/,
    "no-account-type-z-string",
  );
}

// Rule 11: absolute imports from engine internals. The public API is the
// `@/lib/calculators/engine` barrel; any deeper absolute import is a layering
// violation. (Relative imports between engine sibling files are fine — that's
// how the engine composes itself internally.)
function findEngineInternalImportViolations(): Violation[] {
  return findPatternViolations(
    /from\s+["']@\/lib\/calculators\/engine\/[^"']+["']/,
    "no-engine-internal-import",
  );
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

  it("no `displayName ?? accountLabel` inline fallback (use accountDisplayName())", () => {
    const violations = findDisplayNameAccountLabelFallbackViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} display-name-fallback violations. ` +
          `Use accountDisplayName() from @/lib/utils/format instead of the ` +
          `inline \`displayName ?? accountLabel\` pattern — the helper handles ` +
          `the full priority chain and owner suffix logic.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no direct .accountLabel reads in .tsx files (use accountDisplayName())", () => {
    const violations = findDirectAccountLabelReadViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} direct-accountLabel-read violations. ` +
          `Display code should call accountDisplayName(account, ownerName) ` +
          `instead of reading .accountLabel directly — the helper handles ` +
          `displayName override priority and owner naming rules.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no hardcoded performance category strings ('401k/IRA', 'HSA', 'Brokerage')", () => {
    const violations = findHardcodedPerfCategoryViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hardcoded-perf-category violations. ` +
          `Import PERF_CATEGORY_DEFAULT / PERF_CATEGORY_HSA / PERF_CATEGORY_BROKERAGE ` +
          `/ PERF_CATEGORY_RETIREMENT / PERF_CATEGORY_PORTFOLIO from ` +
          `@/lib/config/display-labels.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no useState() with hardcoded account type default", () => {
    const violations = findHardcodedAccountTypeStateViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hardcoded-account-type-state violations. ` +
          `Use getAllCategories()[0]! or another config-derived default for ` +
          `form state initialization.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no inline `.toFixed(N) + '%'` (use formatPercent())", () => {
    const violations = findInlinePercentFormatViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} inline-percent-format violations. ` +
          `Use formatPercent() from @/lib/utils/format for percent display ` +
          `so all call sites render consistently.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no `accountType: z.string()` in mutations (use z.enum(accountCategoryEnum()))", () => {
    const violations = findAccountTypeZStringViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} accountType-z-string violations. ` +
          `Use z.enum(accountCategoryEnum()) so Zod validation stays in sync ` +
          `with the config source of truth.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no absolute imports from engine internals (use the barrel)", () => {
    const violations = findEngineInternalImportViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} engine-internal-import violations. ` +
          `Import from '@/lib/calculators/engine' (the barrel) — only the 4 ` +
          `public functions (calculateProjection, estimateEffectiveTaxRate, ` +
          `incomeCapForMarginalRate, computeTaxableSS) are part of the public ` +
          `API. Relative imports between engine siblings are fine.\n` +
          formatViolations("Violations", violations),
      );
    }
  });
});
