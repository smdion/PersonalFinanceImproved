/**
 * The transport's undici Agent is passed to the global fetch as its
 * dispatcher, which works only when the installed `undici` and the one
 * Node bundles share a major version. A Node bump that moves it fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const major = (version: string) => version.split(".")[0];

describe("undici", () => {
  it("installed is the major Node bundles", () => {
    const installed = (
      JSON.parse(
        readFileSync(
          path.resolve(__dirname, "../../node_modules/undici/package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version;
    expect(major(installed)).toBe(
      major(process.versions.undici ?? "not bundled"),
    );
  });
});
