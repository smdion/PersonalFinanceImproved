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
    expect(inputs.filter((f) => !f.includes("node_modules/")).sort()).toEqual([
      "db-migrate.ts",
      "src/lib/db/demo-schema-marker.ts",
      "src/lib/db/migration-converters.ts",
      "src/lib/db/reference-reconcile-core.ts",
      "src/lib/db/v0102-match-rate.ts",
      "src/lib/db/version-tables.ts",
      "src/lib/utils/match-rate.ts",
    ]);
    expect(
      inputs.filter((f) => /node_modules\/(next|server-only)\//.test(f)),
    ).toEqual([]);
  });
});
