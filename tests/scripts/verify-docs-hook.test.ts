/**
 * The Claude Code hook (.claude/hooks/verify-docs.sh) runs `pnpm
 * docs:verify` only for edits under its scope; scripts/verify-docs.ts
 * counts files in fixed directories. An edit in a counted directory the
 * hook doesn't cover (src/lib/db/pg/ schema files, new test files) drifted
 * the docs silently, so every counted directory must be in scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const hook = readFileSync(".claude/hooks/verify-docs.sh", "utf8");
const scope = (name: string) =>
  new RegExp(hook.match(new RegExp(`^${name}='([^']+)'`, "m"))![1]!);

describe("verify-docs hook scope", () => {
  it("covers a file in every directory docs:verify counts", () => {
    const docs = scope("DOCS_SCOPE");
    for (const file of [
      "src/lib/pure/engine/withdrawal-solver.ts",
      "src/lib/pure/engine/projection.ts",
      "src/lib/pure/simulation/monte-carlo.ts",
      "src/server/routers/settings/tax-limits.ts",
      "src/app/(dashboard)/contributions/page.tsx",
      "src/components/settings/people-settings.tsx",
      "src/components/ui/button.tsx",
      "src/lib/db/pg/contributions.ts",
      "drizzle/0013_v097_loan_feed.sql",
      "tests/routers/demo-postgres.test.ts",
      "tests/e2e/smoke.spec.ts",
    ])
      expect(docs.test(`/repo/${file}`), file).toBe(true);
  });

  it("regenerates the API and schema docs for schema files in src/lib/db/pg/", () => {
    expect(
      scope("API_SCOPE").test("/repo/src/lib/db/pg/contributions.ts"),
    ).toBe(true);
  });
});
