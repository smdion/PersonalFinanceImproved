/**
 * Every check CI runs is also run by one of the three local commands (the
 * gate for a staged change, check:batch for a landing batch, check:release
 * before a release PR), or is listed below as CI-only with its reason. A CI
 * step none of them runs is first seen failing in CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CI_ONLY: Record<string, string> = {
  "Commit rules over the pull request's commits":
    "covered by check:release's commit-rules step over the same range",
  "Cache Next.js build": "CI cache, not a check",
  "Cache Playwright browsers": "CI cache, not a check",
  "Install Playwright system deps": "CI runner setup",
  "Install Playwright browsers": "CI runner setup",
  "E2E tests (SQLite + demo mode)":
    "needs the standalone build and a browser; runs in CI only",
  "Upload Playwright report": "CI artifact",
  "Upload Playwright test results (screenshots, traces)": "CI artifact",
  "Docker build smoke test": "needs Docker; runs in CI only",
  "Compose install boots on an empty volume": "needs Docker; runs in CI only",
  "Upload first-run E2E results (screenshots, traces)": "CI artifact",
  "Notify on failure": "CI notification, not a check",
};

/** Each named CI step and the shell commands of its `run:`. */
function ciSteps(yaml: string): { name: string; commands: string[] }[] {
  const steps: { name: string; commands: string[] }[] = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const name = /^\s*- name: (.+)$/.exec(lines[i]!)?.[1]?.trim();
    if (!name) continue;
    const commands: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (/^\s*- (name|uses|run):/.test(line)) break;
      const single = /^\s*run: (?!\|)(.+)$/.exec(line)?.[1];
      if (single) commands.push(single.trim());
      if (/^\s*run: \|/.test(line)) {
        const indent = /^(\s*)/.exec(line)![1]!.length;
        for (let k = j + 1; k < lines.length; k++) {
          const body = lines[k]!;
          if (body.trim() && /^(\s*)/.exec(body)![1]!.length <= indent) break;
          commands.push(body.trim());
        }
      }
    }
    steps.push({
      name,
      commands: commands.filter((c) => /^(pnpm|npx|bash) /.test(c)),
    });
  }
  return steps;
}

/** The part of a CI command a local script must also name. */
function checkKey(command: string): string {
  const words = command.replace(/^pnpm (run |-s )?/, "").split(/\s+/);
  if (words[0] === "tsx" || words[0] === "bash") return words[1]!;
  if (words[0] === "npx") return words.slice(1, 3).join(" ");
  if (words[0] === "test" && words[1]) return words[1];
  return words[0]!;
}

describe("CI parity", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const local = [
    "scripts/gate.sh",
    "scripts/check-batch.sh",
    "scripts/check-release.sh",
  ]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("finds CI's steps", () => {
    expect(ciSteps(ci).length).toBeGreaterThan(20);
  });

  it("runs every CI check locally, or lists it as CI-only", () => {
    const missing = ciSteps(ci)
      .filter((s) => !(s.name in CI_ONLY))
      .flatMap((s) =>
        s.commands
          .filter((c) => !/^pnpm install\b/.test(c))
          .map((c) => ({ step: s.name, key: checkKey(c) }))
          .filter(({ key }) => !local.includes(key)),
      );
    expect(missing).toEqual([]);
  });

  it("lists no CI-only step that CI no longer has", () => {
    const names = new Set(ciSteps(ci).map((s) => s.name));
    expect(Object.keys(CI_ONLY).filter((n) => !names.has(n))).toEqual([]);
  });
});
