/**
 * The image runs db-migrate.js, the esbuild bundle of db-migrate.ts (built
 * with package.json's build:migrator flags), with no src/, env or Next. Its
 * inputs are db-migrate.ts, the src/ modules it imports, and npm
 * packages that are neither Next nor server-only.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = (
  JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts["build:migrator"]!;
const external = [...script.matchAll(/--external:(\S+)/g)].map((m) => m[1]!);

describe("the migrator bundle", () => {
  it("bundles only its listed src/ modules and no Next code", async () => {
    const { metafile } = await build({
      entryPoints: ["db-migrate.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      external,
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(metafile.inputs);
    // Sorted on both sides: a moved module keeps its line in this list.
    expect(inputs.filter((f) => !f.includes("node_modules/")).sort()).toEqual(
      [
        "db-migrate.ts",
        "src/lib/db/backup/backup-file.ts",
        "src/lib/db/migrate/converter-rows.ts",
        "src/lib/db/migrate/converter-refusal.ts",
        "src/lib/db/migrate/converter-writes.ts",
        "src/lib/db/migrate/demo-schema-marker.ts",
        "src/lib/db/env-file.ts",
        "src/lib/db/migrate/migration-converters.ts",
        "src/lib/db/migrate/reference-reconcile-core.ts",
        "src/lib/db/migrate/v0102-match-rate.ts",
        "src/lib/db/migrate/v0102-match-value.ts",
        "src/lib/db/migrate/v0106-retirement-people.ts",
        "src/lib/db/migrate/v0106-budget-amounts.ts",
        "src/lib/db/migrate/v0106-net-pay-snapshot.ts",
        "src/lib/db/migrate/v0106-credentials.ts",
        "src/lib/db/migrate/v0106-mapping-ids.ts",
        "src/lib/db/migrate/v0106-joint-person-ids.ts",
        "src/lib/db/migrate/v0106-cached-months.ts",
        "src/lib/db/migrate/v0106-salary-entries.ts",
        "src/lib/db/migrate/v0106-active-fields.ts",
        "src/lib/db/migrate/v0106-performance-category.ts",
        "src/lib/db/migrate/v0106-retired-limits.ts",
        "src/lib/db/migrate/v0106-after-tax-exempt.ts",
        "src/lib/db/migrate/v0106-stored-json.ts",
        "src/lib/db/migrate/frozen-shape.ts",
        "src/lib/db/backup/version-tables.ts",
        "src/lib/utils/match-rate.ts",
        "src/lib/crypto-envelope.ts",
        "src/lib/config/budget-apps.ts",
        "src/lib/config/enum-values.ts",
        "src/lib/config/filing-status.ts",
      ].sort(),
    );
    expect(
      inputs.filter((f) => /node_modules\/(next|server-only)\//.test(f)),
    ).toEqual([]);
    // tsx runs db-migrate.ts from other folders (the PostgreSQL migration
    // tests), where the "@/" alias doesn't resolve: its sources import by path.
    expect(
      inputs
        .filter((f) => f.startsWith("src/"))
        .filter((f) => /from "@\//.test(readFileSync(f, "utf8"))),
    ).toEqual([]);
  });
});
