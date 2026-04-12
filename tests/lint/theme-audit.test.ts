/**
 * Theme audit (v0.5 expert-review M26 — expanded scope).
 *
 * Static-string scan that flags hardcoded gray Tailwind utility classes
 * in component files. Prefer the centralized design tokens defined in
 * src/app/globals.css (bg-surface-*, text-primary, text-muted, border-default,
 * etc.) over raw bg-gray-N00 / text-gray-N00 because:
 *
 *   1. The tokens auto-adapt to dark mode without dual classes
 *   2. Theme changes happen in one place (CSS variables in globals.css)
 *   3. Prevents the toggle.tsx-style regression where bg-gray-400 read
 *      fine in light mode but became invisible on certain dark surfaces
 *
 * Status colors (text-red-600, text-green-600, text-amber-800, etc.) are
 * NOT covered — those are intentional and shared across components.
 *
 * Escape hatch: add `// theme-audit-ok: <reason>` on or above the line
 * if a hardcoded gray is intentional (e.g., a one-off illustration).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = path.resolve(__dirname, "../../src");

// Files that legitimately use raw color utilities. Each entry includes a
// reason; adding requires reviewer signoff.
const EXEMPT: Set<string> = new Set([
  // Skeleton colors are deliberately fixed because skeletons should look
  // the same regardless of theme — they're loading placeholders.
  "src/components/ui/skeleton.tsx",
  // Tooltip + ConfirmDialog use raw colors for high-contrast emergency UI.
  "src/components/ui/tooltip.tsx",
  // Theme picker itself.
  "src/components/ui/theme-toggle.tsx",

  // Pre-v0.5 sweep — TODO replace with design tokens in v0.5.x follow-up.
  // Tracked in .scratch/docs/expert-review-decisions.md → M26. The audit's
  // lasting value is catching NEW regressions; these existing files are
  // grandfathered until a focused theme-cleanup PR.
  "src/app/(dashboard)/budget/page.tsx",
  "src/app/(dashboard)/data-browser/page.tsx",
  "src/components/cards/dashboard/contributions-card.tsx",
  "src/components/cards/projection/projection-hero-kpis.tsx",
  "src/components/cards/projection/projection-mc-results.tsx",
  "src/components/layout/scenario-bar.tsx",
  "src/components/mortgage/refinance-history.tsx",
  "src/components/mortgage/refinance-impact.tsx",
  "src/components/networth/net-worth-composition.tsx",
  "src/components/networth/spreadsheet/spreadsheet-controls.tsx",
]);

// Patterns we flag. Tailwind gray-N00 utilities specifically — other
// colors (red/amber/green/blue) are usually status, not theme.
const GRAY_PATTERN =
  /\b(?:bg|text|border|hover:bg|hover:text|focus:bg|focus:text|focus:ring|dark:bg|dark:text|dark:border)-gray-\d{2,3}/;

interface ThemeViolation {
  file: string;
  line: number;
  snippet: string;
}

function* walkComponentFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walkComponentFiles(full);
    } else if (e.isFile() && /\.tsx$/.test(e.name)) {
      yield full;
    }
  }
}

function relPath(abs: string): string {
  return path.relative(path.resolve(__dirname, "../.."), abs);
}

function findGrayViolations(): ThemeViolation[] {
  const violations: ThemeViolation[] = [];
  for (const file of walkComponentFiles(SRC_DIR)) {
    const rel = relPath(file);
    if (EXEMPT.has(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      // Inline escape hatch on this line or any of the 3 preceding
      const hasEscape =
        line.includes("theme-audit-ok") ||
        (i > 0 && lines[i - 1]!.includes("theme-audit-ok")) ||
        (i > 1 && lines[i - 2]!.includes("theme-audit-ok")) ||
        (i > 2 && lines[i - 3]!.includes("theme-audit-ok"));
      if (hasEscape) continue;
      if (GRAY_PATTERN.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          snippet: trimmed.slice(0, 100),
        });
      }
    }
  }
  return violations;
}

describe("theme audit (M26 — centralize colors)", () => {
  it("no hardcoded *-gray-N00 utilities (use design tokens)", () => {
    const violations = findGrayViolations();
    if (violations.length > 0) {
      const summary = violations
        .slice(0, 30)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.snippet}`)
        .join("\n");
      const more =
        violations.length > 30 ? `\n  …and ${violations.length - 30} more` : "";
      expect.fail(
        `Found ${violations.length} hardcoded gray utility classes in ` +
          `component files. Use design tokens from src/app/globals.css ` +
          `(bg-surface-*, text-primary, text-muted, border-default, etc.) ` +
          `instead. Add \`// theme-audit-ok: <reason>\` on or above the ` +
          `line if a hardcoded gray is intentional.\n\nViolations:\n${summary}${more}`,
      );
    }
  });
});
