import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * scripts/ci-changes.sh in a scratch repository, with a stand-in gh that
 * lists the commits CI "passed" (FAKE_GREEN, one sha a line).
 */
describe("ci-changes.sh", () => {
  let dir: string;
  let bin: string;
  const script = path.resolve("scripts/ci-changes.sh");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const commit = (file: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.appendFileSync(path.join(dir, file), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", `change ${file}`);
    return git("rev-parse", "HEAD");
  };
  const run = (event: string, ref: string, green: string[]) => {
    const output = path.join(dir, "..", `out-${Math.random()}`);
    const result = spawnSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: ref,
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_OUTPUT: output,
        FAKE_GREEN: green.join("\n"),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    return fs.readFileSync(output, "utf8").trim().split("\n");
  };

  beforeAll(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "ledgr-ci-changes-"));
    dir = path.join(root, "repo");
    bin = path.join(root, "bin");
    fs.mkdirSync(dir);
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "gh"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_GREEN"\n',
    );
    fs.chmodSync(path.join(bin, "gh"), 0o755);
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
  });

  afterAll(() => {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it("always tests the image on a pull request and a v* push", () => {
    const sha = commit("src/app/page.tsx");
    expect(run("pull_request", "refs/pull/1/merge", [sha])).toEqual([
      "code=true",
      "image=true",
    ]);
    expect(run("push", "refs/heads/v0.10.2", [sha])).toEqual([
      "code=true",
      "image=true",
    ]);
  });

  it("on main, tests the image only when its inputs changed since the newest green ancestor", () => {
    const green = commit("src/app/a.tsx");
    commit("src/app/b.tsx");
    expect(run("push", "refs/heads/main", [green])).toEqual([
      "code=true",
      "image=false",
    ]);
    commit("Dockerfile");
    expect(run("push", "refs/heads/main", [green])).toEqual([
      "code=true",
      "image=true",
    ]);
  });

  it("compares with the green ancestor, not the cancelled push before", () => {
    const green = commit("src/app/c.tsx");
    commit("pnpm-lock.yaml"); // its run was cancelled: never green
    commit("src/app/d.tsx");
    expect(run("push", "refs/heads/main", [green])).toEqual([
      "code=true",
      "image=true",
    ]);
  });

  it("skips the heavy steps and the image for a docs-only push", () => {
    const green = commit("src/app/f.tsx");
    commit("docs/OPS.md");
    commit("README.md");
    for (const ref of ["refs/heads/main", "refs/heads/v0.10.2"])
      expect(run("push", ref, [green])).toEqual(["code=false", "image=false"]);
    expect(run("pull_request", "refs/pull/1/merge", [green])).toEqual([
      "code=true",
      "image=true",
    ]);
    commit("docs/CALCULATIONS.md");
    expect(run("push", "refs/heads/v0.10.2", [green])).toEqual([
      "code=true",
      "image=true",
    ]);
    commit("src/app/g.tsx");
    expect(run("push", "refs/heads/v0.10.2", [green])).toEqual([
      "code=true",
      "image=true",
    ]);
  });

  it("tests everything with no green ancestor", () => {
    commit("src/app/e.tsx");
    expect(run("push", "refs/heads/main", [])).toEqual([
      "code=true",
      "image=true",
    ]);
  });
});
