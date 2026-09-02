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
 *    7. Hardcoded performance category strings in logic — bracket-index OR equality (use PERF_CATEGORY_* constants)
 *    8. useState with hardcoded account type ("401k", "ira", etc.)
 *    9. Inline `.toFixed(N) + "%"` instead of formatPercent()
 *   10. Mutation using `z.string()` for enum-typed fields (accountType, service) instead of z.enum()
 *   11. Absolute imports from engine internals instead of the barrel
 *   12. Hand-rolled Modified-Dietz denominators outside performance.ts
 *   13. Raw division inside formatPercent() instead of safeDivide() (H1/M1/M36/L9 class)
 *   14. Tailwind-class-returning color helper passed to inline style backgroundColor (M18 class)
 *   15. `import { z } from "zod"` instead of "zod/v4"
 *   16. taxYear/projectionYear z.number().int() field missing .min()/.max() bounds (M10 class)
 *   17. accountLabel fallback built from a template literal instead of null (M40 class)
 *   18. Hook file under src/lib/hooks/ using React hooks without a "use client" directive (H4 class)
 *   19. Local `type X = ReturnType<typeof useYState>` redeclaration instead of importing the canonical type (L37 class)
 *   20. "Monte Carlo" in user-facing .tsx text (JSX text/string literals) — use "Simulation"/"Simulations" (L126 class)
 *   21. `process.env.CRON_SECRET` read outside src/lib/auth/cron.ts (H1 class)
 *   22. API route under src/app/api/ that writes to the DB with no DEMO_ONLY guard (M5 class)
 *   23. { MFJ: <figure> Single: <figure> HOH: <figure> } object literal outside src/lib/config/ (R43 audit F4 class)
 *   24. Local const re-declaring an ALL_CAPS name already exported from constants.ts / config/ (R43 audit F1 class)
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

// Canonical performance-category display strings — these should always be
// referenced via the PERF_CATEGORY_* constants from display-labels.ts,
// never hardcoded as literals in logic or data-access code.
const CANONICAL_PERF_CATEGORIES = [
  "401k/IRA",
  "HSA",
  "Brokerage",
  "Retirement",
  "Portfolio",
] as const;

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

// Rule 7: hardcoded performance-category strings used in logic — bracket-index
// access OR equality/inequality comparisons. Both forms should import the
// PERF_CATEGORY_* constants from display-labels.ts so a rename in one place
// propagates everywhere.
//
// Catches:
//   x["Retirement"]  /  x?.["HSA"]          — bracket-index form
//   x === "Portfolio"  /  x !== "Brokerage"  — equality form
//
// Does NOT match display strings in JSX text nodes, type unions (| "Retirement"),
// or arbitrary object labels (label: "Retirement"). Those are legitimate literal
// uses that don't participate in programmatic comparisons.
function findHardcodedPerfCategoryViolations(): Violation[] {
  const cats = CANONICAL_PERF_CATEGORIES.map((c) => c.replace("/", "\\/")).join(
    "|",
  );
  // Bracket-index: x["Retirement"] or x?.["Portfolio"]
  const bracketSrc = `\\??\\.[?]?\\[\\s*["'](?:${cats})["']\\s*\\]`;
  // Equality/inequality: === "Retirement" or !== "Brokerage"
  const equalitySrc = `(?:===|!==)\\s*["'](?:${cats})["']`;
  const combined = new RegExp(`(?:${bracketSrc}|${equalitySrc})`);
  return findPatternViolations(combined, "no-hardcoded-perf-category", {
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

// Rule 10: mutation using `z.string()` for known-enum fields.
// `accountType` should be `z.enum(accountCategoryEnum())`.
// `service` should be `z.enum(["ynab","actual"])` in sync procedures
//   (or the serviceEnum from sync/_shared).
// Budget `category` and account `subType` are intentionally free-text and excluded.
// admin.ts apiConnections CRUD is exempt: it's generic CRUD over any service type,
//   not constrained to ynab/actual (tests use "simplefin", "monarch", etc.).
function findStringEnumFieldViolations(): Violation[] {
  return findPatternViolations(
    /\b(?:accountType|service)\s*:\s*z\.string\b/,
    "no-string-enum-fields",
    {
      additionalExempt: new Set(["src/server/routers/settings/admin.ts"]),
    },
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

// Rule 12: hand-rolled Modified-Dietz denominators outside computeReturn().
// The shape `beginBal + (... - distributions - fees) / 2` must live in
// exactly one place — src/lib/pure/performance.ts — so a formula fix (e.g.
// adding a missing term like rollovers) doesn't need to be applied in N
// places again. This regex is name-dependent (keyed on `beginBal`), not
// structural — it catches the exact shape previously duplicated in
// snapshot.ts, not a differently-named future reimplementation.
function findHandRolledDietzDenominatorViolations(): Violation[] {
  return findPatternViolations(
    /\bbeginBal\s*\+\s*\([^)]*distributions[^)]*fees[^)]*\)\s*\/\s*2/,
    "no-hand-rolled-dietz-denominator",
    { additionalExempt: new Set(["src/lib/pure/performance.ts"]) },
  );
}

// Rule 13: raw division inside formatPercent() instead of safeDivide().
// formatPercent(a / b) renders Infinity/NaN when b is 0 (the M1/M36/L9 bug
// class). Matches `formatPercent(<ident> / <ident-starting-with-a-letter>` —
// the denominator must start with a letter/underscore (not a digit), so
// `formatPercent(pct / 100)`-style percentage-point-to-fraction scale
// conversions (divisor is a literal, can never be 0) don't false-positive;
// only genuine identifier/identifier divisions (where the divisor could
// plausibly be a runtime 0) are flagged.
function findRawDivisionInFormatPercentViolations(): Violation[] {
  return findPatternViolations(
    /formatPercent\(\s*[\w.]+\s*\/\s*[a-zA-Z_][\w.]*/,
    "no-raw-division-in-format-percent",
    { additionalExempt: new Set(["src/lib/utils/format.ts"]) },
  );
}

// Rule 14: a Tailwind-class-returning color helper (accountColor,
// accountMatchColor, accountBorderColor, accountTextColor — all defined in
// colors.ts to return strings like "bg-blue-500") passed to an inline style
// backgroundColor. Silently renders no color (M18) — inline styles need a
// real hex value (categoryChartHex, CHART_COLORS, BRAND_COLORS, etc.).
function findColorHelperAsInlineStyleViolations(): Violation[] {
  return findPatternViolations(
    /backgroundColor:\s*(?:account(?:Color|MatchColor|BorderColor|TextColor))\(/,
    "no-tailwind-color-helper-as-inline-style",
  );
}

// Rule 15: `import { z } from "zod"` instead of "zod/v4". Recurred
// independently at least twice (L39, L124) — every other file in the repo
// uses the v4 import.
function findLegacyZodImportViolations(): Violation[] {
  return findPatternViolations(/from\s+["']zod["']/, "no-legacy-zod-import");
}

// Rule 16: taxYear/projectionYear z.number().int() fields with no bounds.
// The same unbounded-year bug (M10) was found independently in two
// different router files (settings/retirement.ts, projection/_shared.ts)
// months apart — the pattern recurs because there's no default. Only
// matches the exact `z.number().int()` shape with nothing chained after,
// so a field that already has `.min(...)` doesn't false-positive.
function findUnboundedYearFieldViolations(): Violation[] {
  return findPatternViolations(
    /\b(?:taxYear|projectionYear)\s*:\s*z\.number\(\)\.int\(\)\s*[,)]/,
    "no-unbounded-year-field",
  );
}

// Rule 17: accountLabel built from a template literal containing
// accountType, passed as a fallback into accountDisplayName(). Skips its
// casing-aware Priority-3 construction and returns the raw lowercase DB key
// verbatim (M40) — pass `accountLabel: null` instead and let
// accountDisplayName() build the label itself.
function findAccountLabelTemplateFallbackViolations(): Violation[] {
  return findPatternViolations(
    /accountLabel:\s*(?:[\w.?? ]*)?`\$\{[\w.]*accountType\}/,
    "no-account-label-template-fallback",
  );
}

// Rule 18: a file under src/lib/hooks/ that calls a React hook
// (useState/useEffect/useRef/useCallback/useMemo/useContext) but doesn't
// start with a "use client" directive. Crashes at runtime if imported from
// a Server Component (H4 — found 4 instances in this exact directory).
function findMissingUseClientOnHookViolations(): Violation[] {
  const violations: Violation[] = [];
  const HOOKS_DIR = path.join(SRC_DIR, "lib/hooks");
  if (!fs.existsSync(HOOKS_DIR)) return violations;
  const reactHookPattern =
    /\buse(?:State|Effect|Ref|Callback|Memo|Context|Reducer|LayoutEffect)\(/;
  for (const file of walkTsFiles(HOOKS_DIR)) {
    const rel = relPath(file);
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    const usesReactHook = lines.some((l) => reactHookPattern.test(l));
    if (!usesReactHook) continue;
    const firstContentLine = lines.find((l) => l.trim().length > 0) ?? "";
    if (!firstContentLine.trim().startsWith('"use client"')) {
      violations.push({
        file: rel,
        line: 1,
        rule: "no-missing-use-client-on-hook",
        snippet: firstContentLine.trim().slice(0, 100),
      });
    }
  }
  return violations;
}

// Rule 19: local `type X = ReturnType<typeof useYState>` redeclaration.
// Found independently in 7 files (L37, .scratch/docs/review-findings.md) —
// each copy is a second source of truth for the same type. If the source
// hook's return shape changes, a stale local alias can mask a type error in
// whichever file didn't get the memo, instead of surfacing it everywhere at
// once. Import the canonical type instead of re-deriving it.
function findLocalReturnTypeAliasViolations(): Violation[] {
  return findPatternViolations(
    /^\s*type\s+\w+\s*=\s*ReturnType<typeof use\w+>/,
    "no-local-return-type-alias",
  );
}

// Rule 20: "Monte Carlo" (exact phrase, case-sensitive) in .tsx files —
// user-facing text must say "Simulation"/"Simulations" instead (mandatory
// terminology rule; internal code/variable/procedure names like
// `calculateMonteCarlo()` or `mcTrials` are unaffected — those live in .ts
// files or are identifiers, not this literal two-word phrase).
//
// Restricted to .tsx (where JSX text and display strings actually live) —
// PLUS src/lib/pure/report/**/*.ts (the retirement advisor report's
// narrative-generation module): that directory's whole purpose is
// generating user-facing prose as plain strings, not JSX, so it's exactly
// the kind of file this rule exists for even though it isn't a .tsx —
// found live, 2026-08-31, while scoping that feature: an enforcement hole
// this rule's original .tsx-only scoping would have otherwise left open
// in the one new place most of that feature's prose lives.
// Does NOT use findPatternViolations directly: the shared walker's comment
// filter only recognizes `//`- and `*`-prefixed lines (block-comment
// continuation style), but this codebase also has single-line JSDoc like
// `/** ...Monte Carlo... */` (projection-mc-results.tsx, projection-table.tsx,
// projection-table-mc-cell.tsx, projection-loader.tsx) which starts with "/"
// and would slip through. This walks the same way but additionally skips
// lines whose trimmed content starts with "/*" or "/**".
const MONTE_CARLO_PATTERN = /\bMonte Carlo\b/;
function isMonteCarloTerminologyScanned(rel: string): boolean {
  return rel.endsWith(".tsx") || rel.startsWith("src/lib/pure/report/");
}
function findMonteCarloUserFacingTextViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (!isMonteCarloTerminologyScanned(rel)) continue;
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      ) {
        continue;
      }
      if (
        line.includes("lint-violation-ok") ||
        (i > 0 && lines[i - 1]!.includes("lint-violation-ok")) ||
        (i > 1 && lines[i - 2]!.includes("lint-violation-ok")) ||
        (i > 2 && lines[i - 3]!.includes("lint-violation-ok"))
      ) {
        continue;
      }
      if (MONTE_CARLO_PATTERN.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: "no-monte-carlo-user-facing-text",
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

// Rule 21: `process.env.CRON_SECRET` read outside src/lib/auth/cron.ts.
// H1 fixed a timing-unsafe secret comparison by centralizing every
// cron-route secret check into that one file's getValidCronSecret() /
// validateCronBearerRequest() / validateCronHeaderRequest(). A new route
// reading the env var directly reopens the door to a hand-rolled (and
// possibly timing-unsafe) comparison. env.ts (startup validation, no
// comparison) and instrumentation.node.ts (sends the secret as an outgoing
// header to call our own routes, doesn't compare it) are legitimate direct
// readers and stay exempt.
function findDirectCronSecretReadViolations(): Violation[] {
  return findPatternViolations(
    /process\.env\.CRON_SECRET/,
    "no-direct-cron-secret-read",
    {
      additionalExempt: new Set([
        "src/lib/auth/cron.ts",
        "src/lib/env.ts",
        "src/instrumentation.node.ts",
      ]),
    },
  );
}

// Rule 22: an API route under src/app/api/ that writes to the DB with no
// DEMO_ONLY guard. M5 found one cron route missing the guard every sibling
// write route had; while scoping this rule, the same gap turned up
// independently in two MORE sibling routes (startup/route.ts,
// simplefin/daily/route.ts) that the original review never flagged — fixed
// alongside adding this rule. Detecting "does this route write" precisely
// would need semantic analysis (writes often happen via an imported helper,
// not an inline `.insert(`), so this uses an explicit allowlist of the
// routes that are read-only or enforce demo-mode elsewhere (health checks,
// the tRPC catch-all — per-procedure enforcement, not per-route; NextAuth)
// instead of a content heuristic. Every other route.ts must contain the
// string "DEMO_ONLY" somewhere.
const DEMO_GUARD_EXEMPT_ROUTES = new Set([
  "src/app/api/health/route.ts",
  "src/app/api/health/detailed/route.ts",
  "src/app/api/trpc/[trpc]/route.ts",
  "src/app/api/auth/[...nextauth]/route.ts",
]);
function findMissingDemoOnlyGuardViolations(): Violation[] {
  const violations: Violation[] = [];
  const API_DIR = path.join(SRC_DIR, "app/api");
  if (!fs.existsSync(API_DIR)) return violations;
  for (const file of walkTsFiles(API_DIR)) {
    if (!file.endsWith("route.ts")) continue;
    const rel = relPath(file);
    if (DEMO_GUARD_EXEMPT_ROUTES.has(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    if (!content.includes("DEMO_ONLY")) {
      violations.push({
        file: rel,
        line: 1,
        rule: "no-missing-demo-only-guard",
        snippet: "(no DEMO_ONLY check found anywhere in file)",
      });
    }
  }
  return violations;
}

// Rule 23 (R43): a `{ MFJ: <figure> … Single: <figure> … HOH: <figure> }`-
// shaped object literal outside src/lib/config/. Every filing-status-keyed
// tax FIGURE (a rate, threshold, or bracket table) belongs in a config
// module (see docs/RULES.md § Data-Driven Architecture and the R43 audit)
// — a re-declared one outside config/ is exactly the class of duplication
// that let `SS_TAX_THRESHOLDS` sit inline in an engine module with no
// config home (F4). Deliberately scoped to FIGURE values (the value after
// `MFJ:` must start with a digit, `[`, or `{` — a number, array, or nested
// object) so it does NOT flag `{ MFJ: "Married Filing Jointly", … }`-style
// UI display-label maps, which are a real but separate concern (RULES.md's
// "local label map duplicating config" rule already covers those) —
// several exist in Settings editor components and are legitimate there.
// Whole-file regex (not line-by-line — a real multi-line literal spans
// several lines) matching the three keys within one balanced-ish brace
// span. Narrower than a full parser, which is fine: false negatives (a
// literal spread oddly enough to dodge the regex) are acceptable for a
// lint sweep; false positives are not, hence the curated exempt set below.
const FILING_STATUS_OBJECT_LITERAL_PATTERN =
  /\{[^{}]*\bMFJ\s*:\s*[\d[{][^{}]*\bSingle\s*:[^{}]*\bHOH\s*:[^{}]*\}/s;
const FILING_STATUS_LITERAL_EXEMPT = new Set([
  // Type/union declarations and Zod enums name the three statuses as
  // STRING VALUES ("MFJ" | "Single" | ...), not as object keys (MFJ: …) —
  // the pattern only matches the latter, but these files are exempted
  // defensively since they're the canonical definition site for the
  // enum itself, not a figure.
  "src/lib/config/enum-values.ts",
  "src/lib/calculators/types/shared.ts",
  // Schema files reference the column's runtime type, not a literal.
  "src/lib/db/schema-pg.ts",
  "src/lib/db/schema-sqlite.ts",
]);
function findFilingStatusObjectLiteralViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (rel.startsWith("src/lib/config/")) continue;
    if (FILING_STATUS_LITERAL_EXEMPT.has(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("lint-violation-ok")) continue;
    const m = FILING_STATUS_OBJECT_LITERAL_PATTERN.exec(content);
    if (m) {
      const line = content.slice(0, m.index).split("\n").length;
      violations.push({
        file: rel,
        line,
        rule: "no-filing-status-object-literal-outside-config",
        snippet: m[0].replace(/\s+/g, " ").slice(0, 100),
      });
    }
  }
  return violations;
}

// Rule 24 (R43): re-declaring an ALL_CAPS constant already exported from
// src/lib/constants.ts or src/lib/config/*.ts anywhere else in src/. Two-
// phase: collect the export names from the canonical modules, then scan
// every OTHER file for a local `const` declaration reusing one of those
// names — the exact pattern that let withdrawal-strategy-narrative.ts
// silently redeclare `NIIT_RATE = 0.038` instead of importing it from
// config/niit.ts. Deliberately scoped to ALL_CAPS constant names only, not
// PascalCase types/interfaces — a local component legitimately narrows or
// shadows a type name for its own scoped purpose far more often than it
// legitimately redeclares a shouting-case constant, so the type-name
// version of this check is left for a human pass, not a lint gate.
const CONFIG_EXPORT_DIRS = ["src/lib/constants.ts", "src/lib/config"];
const RESERVED_NAME_PATTERN = /^[A-Z][A-Z0-9_]{3,}$/;
const REDECLARATION_EXEMPT = new Set([
  // The config modules themselves are the canonical declaration site.
  ...walkConfigFiles(),
]);
function walkConfigFiles(): string[] {
  const files: string[] = [];
  for (const dir of CONFIG_EXPORT_DIRS) {
    const abs = path.resolve(__dirname, "../..", dir);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) {
      files.push(dir);
      continue;
    }
    for (const file of walkTsFiles(abs)) files.push(relPath(file));
  }
  return files;
}
function collectConfigExportNames(): Set<string> {
  const names = new Set<string>();
  const exportRe =
    /export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)|export\s+type\s+([A-Za-z0-9_]+)/g;
  for (const rel of walkConfigFiles()) {
    const abs = path.resolve(__dirname, "../..", rel);
    const content = fs.readFileSync(abs, "utf8");
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(content)) !== null) {
      const name = m[1] ?? m[2]!;
      if (RESERVED_NAME_PATTERN.test(name)) names.add(name);
    }
  }
  return names;
}
function findRedeclaredConfigExportViolations(): Violation[] {
  const violations: Violation[] = [];
  const reserved = collectConfigExportNames();
  const declRe =
    /^\s*(?:export\s+)?(?:const|function|class|interface|enum)\s+([A-Za-z0-9_]+)\b/;
  const typeDeclRe = /^\s*(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/;
  for (const file of walkTsFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (REDECLARATION_EXEMPT.has(rel)) continue;
    if (isExempt(rel)) continue;
    const lines = readFileLines(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes("lint-violation-ok")) continue;
      const m = declRe.exec(line) ?? typeDeclRe.exec(line);
      if (!m) continue;
      const name = m[1]!;
      if (!reserved.has(name)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        rule: "no-redeclared-config-export",
        snippet: line.trim().slice(0, 100),
      });
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

  it("no hardcoded perf-category strings in logic — bracket-index or equality (use PERF_CATEGORY_* constants)", () => {
    const violations = findHardcodedPerfCategoryViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hardcoded-perf-category violations. ` +
          `Import PERF_CATEGORY_DEFAULT / PERF_CATEGORY_HSA / PERF_CATEGORY_BROKERAGE ` +
          `/ PERF_CATEGORY_RETIREMENT / PERF_CATEGORY_PORTFOLIO from ` +
          `@/lib/config/display-labels instead of comparing or indexing ` +
          `with literal strings.\n` +
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

  it("no z.string() for known-enum fields (accountType, service) — use z.enum()", () => {
    const violations = findStringEnumFieldViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} string-enum-field violations. ` +
          `Use z.enum(accountCategoryEnum()) for accountType, ` +
          `z.enum(["ynab","actual"]) for service. ` +
          `Budget category and account subType are free-text and exempt.\n` +
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

  it("no hand-rolled Modified-Dietz denominators (use computeReturn()/sumAccounts() from src/lib/pure/performance.ts)", () => {
    const violations = findHandRolledDietzDenominatorViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hand-rolled-dietz-denominator violations. ` +
          `Use computeReturn()/sumAccounts() from src/lib/pure/performance.ts ` +
          `instead of reimplementing the return formula.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no raw division inside formatPercent() (use safeDivide())", () => {
    const violations = findRawDivisionInFormatPercentViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} raw-division-in-formatPercent violations. ` +
          `Wrap the division in safeDivide() from src/lib/utils/math.ts — an ` +
          `unguarded divisor of 0 renders Infinity/NaN.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no Tailwind-class-returning color helper passed to inline style backgroundColor", () => {
    const violations = findColorHelperAsInlineStyleViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} color-helper-as-inline-style violations. ` +
          `accountColor()/accountMatchColor()/accountBorderColor()/accountTextColor() ` +
          `return Tailwind class strings, not hex — use categoryChartHex() or a ` +
          `CHART_COLORS/BRAND_COLORS hex value for inline styles instead.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it('no `import { z } from "zod"` (use "zod/v4")', () => {
    const violations = findLegacyZodImportViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} legacy-zod-import violations. ` +
          `Import from "zod/v4" like every other file in the repo.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no unbounded taxYear/projectionYear z.number().int() fields", () => {
    const violations = findUnboundedYearFieldViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} unbounded-year-field violations. ` +
          `Add .min(1900).max(2100) (or similar) — this exact gap was found ` +
          `independently in two different router files.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no accountLabel fallback built from a template literal (use null)", () => {
    const violations = findAccountLabelTemplateFallbackViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} accountLabel-template-fallback violations. ` +
          `Pass accountLabel: null instead — accountDisplayName() falls through ` +
          `to its own casing-aware construction; a hand-built fallback string can ` +
          `get returned verbatim (raw lowercase DB key) instead.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it('no hook in src/lib/hooks/ using React hooks without a "use client" directive', () => {
    const violations = findMissingUseClientOnHookViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} missing-use-client-on-hook violations. ` +
          `Add "use client"; as the first line — importing a hook that calls ` +
          `React hooks from a Server Component crashes at runtime.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no local `type X = ReturnType<typeof useYState>` redeclaration", () => {
    const violations = findLocalReturnTypeAliasViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} local-return-type-alias violations. ` +
          `Import the canonical type instead of re-deriving it locally — a ` +
          `stale local alias can mask a type error when the source hook's ` +
          `return shape changes.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it('no "Monte Carlo" in user-facing .tsx text (use "Simulation"/"Simulations")', () => {
    const violations = findMonteCarloUserFacingTextViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} Monte-Carlo-user-facing-text violations. ` +
          `User-facing text (JSX text, tooltips, labels, titles) must say ` +
          `"Simulation"/"Simulations" instead of "Monte Carlo" — internal code ` +
          `(variable names, function names like calculateMonteCarlo(), tRPC ` +
          `procedure names, .ts-only comments) may keep "monteCarlo"/"mc" naming.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no direct process.env.CRON_SECRET read outside src/lib/auth/cron.ts", () => {
    const violations = findDirectCronSecretReadViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} direct-cron-secret-read violations. ` +
          `Use getValidCronSecret()/validateCronBearerRequest()/` +
          `validateCronHeaderRequest() from src/lib/auth/cron.ts instead of ` +
          `reading and comparing the secret directly — a hand-rolled ` +
          `comparison can reintroduce a timing oracle (H1).\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no API route under src/app/api/ missing a DEMO_ONLY guard", () => {
    const violations = findMissingDemoOnlyGuardViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} missing-demo-only-guard violations. ` +
          `Add a DEMO_ONLY check (return 403 "Forbidden: demo mode is ` +
          `read-only" when process.env.DEMO_ONLY === "true") before any DB ` +
          `write, matching every sibling write route. If this route is ` +
          `genuinely read-only or enforces demo-mode elsewhere, add it to ` +
          `DEMO_GUARD_EXEMPT_ROUTES in this file instead.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no { MFJ: … Single: … HOH: … } object literal outside src/lib/config/ (R43)", () => {
    const violations = findFilingStatusObjectLiteralViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} filing-status-object-literal violations. ` +
          `Every filing-status-keyed tax figure belongs in a config module ` +
          `(src/lib/config/) — move this table there and import it, rather ` +
          `than re-declaring it. If this really is the canonical definition ` +
          `site for the MFJ/Single/HOH enum itself (not a figure), add it to ` +
          `FILING_STATUS_LITERAL_EXEMPT in this file instead.\n` +
          formatViolations("Violations", violations),
      );
    }
  });

  it("no re-declared name already exported from constants.ts / config/ (R43)", () => {
    const violations = findRedeclaredConfigExportViolations();
    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} redeclared-config-export violations. ` +
          `This name is already exported from src/lib/constants.ts or a ` +
          `src/lib/config/ module — import it instead of re-declaring a ` +
          `local copy that can silently drift from the original.\n` +
          formatViolations("Violations", violations),
      );
    }
  });
});
