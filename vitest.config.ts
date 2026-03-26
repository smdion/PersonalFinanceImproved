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
        "src/server/**",
      ],
      exclude: [
        // Pure type definitions — no runtime code to test
        "src/lib/calculators/types/**",
        "src/lib/types/**",
        // Auth infrastructure — requires real Next.js/NextAuth runtime
        "src/server/auth.ts",
        "src/server/auth.config.ts",
        // Server-side tRPC caller — requires Next.js Server Component context
        "src/server/helpers/server-trpc.ts",
        // Demo router — requires Postgres pool, cookies, schema isolation
        "src/server/routers/demo.ts",
        // Testing router — admin-only on-demand vitest runner
        "src/server/routers/testing.ts",
        // Router re-export barrels
        "src/server/routers/index.ts",
        "src/server/routers/settings/index.ts",
        "src/server/helpers/index.ts",
        // OpenAPI doc generator — runtime-only
        "src/server/api-docs.ts",
        "src/server/routers/api-docs.ts",
        // Data browser — all procedures use db.execute() (Postgres raw SQL)
        "src/server/routers/data-browser.ts",
        // Budget API types — pure type definitions
        "src/lib/budget-api/types.ts",
        // DB connection barrel — runtime pool/connection setup
        "src/lib/db/index.ts",
        // DB schema files — declarative definitions, not logic
        "src/lib/db/schema-pg.ts",
        "src/lib/db/schema-sqlite.ts",
        "src/lib/db/schema.ts",
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
