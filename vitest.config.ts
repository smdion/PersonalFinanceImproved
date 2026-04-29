import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["tests/setup-component.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: [
        "src/lib/calculators/**",
        "src/lib/config/**",
        "src/lib/budget-api/**",
        "src/lib/db/**",
        // src/lib/utils/** is file-by-file. Add utility files here as they
        // get first-class tests. Files not listed are NOT counted toward
        // coverage (neither numerator nor denominator), so gaps stay visible
        // when you audit the exclude list rather than drifting silently.
        "src/lib/utils/account-mapping.ts",
        "src/lib/utils/format.ts",
        "src/lib/utils/math.ts",
        "src/lib/utils/date.ts",
        // src/lib/env.ts — production env invariants (CRON_SECRET,
        // ENCRYPTION_KEY, DEMO_ONLY + NEXT_PHASE carve-outs from v0.5.0).
        // Load-bearing at container boot.
        "src/lib/env.ts",
        "src/server/**",
      ],
      exclude: [
        // Pure type definitions — no runtime code to test
        "src/lib/calculators/types/**",
        "src/lib/types/**",
        // Auth infrastructure — auth.config.ts is edge-runtime metadata only.
        // auth.ts has its testable pure logic (assignRoleAndPermissions,
        // loadPermissionGroups) covered via tests/server/auth-callback.test.ts;
        // the rest of the file is the NextAuth handlers init which can't run
        // in vitest. Leaving auth.ts in coverage so the testable pieces count.
        "src/server/auth.config.ts",
        // Server-side tRPC caller — requires Next.js Server Component context
        "src/server/helpers/server-trpc.ts",
        // Demo router — requires Postgres pool, cookies, schema isolation
        "src/server/routers/demo.ts",
        // Testing router — admin-only on-demand vitest runner
        "src/server/routers/testing.ts",
        // Router re-export barrels and documentation-only files
        "src/server/routers/index.ts",
        "src/server/routers/settings/index.ts",
        "src/server/routers/settings.ts",
        "src/server/helpers/index.ts",
        // Documentation-only (no executable statements)
        "src/server/routers/_shared.ts",
        // OpenAPI doc generator — runtime-only
        "src/server/api-docs.ts",
        "src/server/routers/api-docs.ts",
        // Data browser — all procedures use db.execute() (Postgres raw SQL)
        "src/server/routers/data-browser.ts",
        // Budget API — types and barrel re-exports
        "src/lib/budget-api/types.ts",
        "src/lib/budget-api/index.ts",
        "src/lib/budget-api/interface.ts",
        // Budget API cache — requires DB runtime for upsert/delete
        "src/lib/budget-api/cache.ts",
        // DB connection barrel — runtime pool/connection setup
        "src/lib/db/index.ts",
        // DB schema files — declarative definitions, not logic
        "src/lib/db/schema-pg.ts",
        "src/lib/db/schema-sqlite.ts",
        "src/lib/db/schema.ts",
        // DB runtime — requires live database for transactions/queries
        "src/lib/db/version-logic.ts",
        "src/lib/db/backfill-local-ids.ts",
        "src/lib/db/backfill-perf-ids.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 80,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
