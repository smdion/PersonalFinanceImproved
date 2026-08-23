import { defineConfig } from "vitest/config";
import path from "path";

// Newer Node ships its own native localStorage (Web Storage API), which
// jsdom 29 defers to on Node versions that have it instead of using its
// own implementation. Without a backing file, Node's native localStorage
// is a non-functional stub (window.localStorage is undefined) — pass
// --localstorage-file so it actually works under jsdom in tests. Feature
// -detected via allowedNodeEnvironmentFlags (not a version-number check)
// since older Node (still used by some local dev setups) doesn't
// recognize the flag at all and errors out on an unknown option.
const execArgv = process.allowedNodeEnvironmentFlags.has("--localstorage-file")
  ? [
      `--localstorage-file=${path.resolve(__dirname, ".vitest-localstorage.json")}`,
    ]
  : [];

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    testTimeout: 10000,
    execArgv,
    // Most of the suite (server/routers/calculators/db/pure/helpers/etc.) is
    // pure Node logic that never touches the DOM. Only the files that
    // actually render components/hooks or assert on DOM output need jsdom —
    // paying jsdom's setup cost for every file was a measured chunk of the
    // suite's wall time. Split into projects so each file only pays for the
    // environment it needs. `tests/benchmarks/**` gets its own project (not
    // folded into `node`) so it can be excluded from the default run via
    // `--project=!benchmarks` (a plain CLI --exclude doesn't apply per-
    // project once `projects` is used) while still running via its own
    // `pnpm test:benchmarks` script.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          // tests/components is flat (no subdirectories), so the extglob
          // negation below excludes every file in it except the three that
          // test exported pure helpers, not rendered components — those
          // don't need jsdom and are handled by this project instead.
          exclude: [
            "tests/components/!(linked-balance-card|portfolio-quick-look-stats|projection-utils).test.ts*",
            "tests/hooks/**",
            "tests/accessibility/**",
            "tests/benchmarks/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "benchmarks",
          environment: "node",
          include: ["tests/benchmarks/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["tests/setup-component.ts"],
          include: [
            "tests/components/**/*.test.ts",
            "tests/components/**/*.test.tsx",
            "tests/hooks/**/*.test.ts",
            "tests/accessibility/**/*.test.ts",
            "tests/accessibility/**/*.test.tsx",
          ],
          exclude: [
            "tests/components/linked-balance-card.test.ts",
            "tests/components/portfolio-quick-look-stats.test.ts",
            "tests/components/projection-utils.test.ts",
          ],
        },
      },
    ],
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
