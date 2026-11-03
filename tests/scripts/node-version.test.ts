/**
 * One Node version everywhere it's chosen: the production image (Dockerfile
 * base images), .nvmrc (local tools and CI's setup-node), and package.json
 * engines. CI once tested on 26.5.1 while the image ran 26.12.1, and the
 * dev box ran 22: the same seeded test data came out different across them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const nvmrc = readFileSync(".nvmrc", "utf8").trim();

describe("Node version", () => {
  it("the Dockerfile's base images, .nvmrc and engines agree", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const images = [...dockerfile.matchAll(/^FROM node:([\d.]+)/gm)].map(
      (m) => m[1],
    );
    expect(images.length).toBeGreaterThan(0);
    for (const v of images) expect(v).toBe(nvmrc);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines?: { node?: string };
    };
    expect(pkg.engines?.node).toBe(nvmrc);
  });

  it("no workflow pins its own Node version", () => {
    for (const file of readdirSync(".github/workflows")) {
      const text = readFileSync(`.github/workflows/${file}`, "utf8");
      expect(text, file).not.toMatch(/node-version:\s*\S/);
    }
  });
});
