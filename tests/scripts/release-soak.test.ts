/**
 * scripts/release-soak.ts: `pnpm release` refuses a release under 24 hours
 * after the last release tag unless it's a hotfix whose reason the
 * CHANGELOG entry carries (owner, v0.10.5 Q13). The decision is tested with
 * invented tags; the script runs for real against a throwaway git repo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  changelogSection,
  decideReleaseSoak,
  lastReleaseTag,
} from "../../scripts/release-soak";

const TAGGED_AT = new Date("2031-03-01T12:00:00Z");
const LAST = { name: "v1.4.0", taggedAt: TAGGED_AT };
const hoursAfter = (hours: number) =>
  new Date(TAGGED_AT.getTime() + hours * 60 * 60 * 1000);

describe("decideReleaseSoak", () => {
  it("refuses a release under 24 hours after the last tag", () => {
    const verdict = decideReleaseSoak({
      lastTag: LAST,
      now: hoursAfter(23.5),
      hotfixReason: null,
      section: "",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed ? "" : verdict.reason).toContain(
      "until 2031-03-02T12:00:00.000Z",
    );
  });

  it("allows a release 24 hours or more after the last tag", () => {
    for (const hours of [24, 30]) {
      const verdict = decideReleaseSoak({
        lastTag: LAST,
        now: hoursAfter(hours),
        hotfixReason: null,
        section: "",
      });
      expect(verdict.allowed).toBe(true);
    }
  });

  it("allows the first release, with no tag before it", () => {
    expect(
      decideReleaseSoak({
        lastTag: null,
        now: TAGGED_AT,
        hotfixReason: null,
        section: "",
      }).allowed,
    ).toBe(true);
  });

  it("lets a hotfix through when its CHANGELOG entry names the reason", () => {
    const verdict = decideReleaseSoak({
      lastTag: LAST,
      now: hoursAfter(2),
      hotfixReason: "sign-in loop after the upgrade",
      section: "\n- Hotfix: sign-in loop after the upgrade\n- Fixed it.\n",
    });
    expect(verdict.allowed).toBe(true);
  });

  it("refuses a hotfix whose reason isn't in the CHANGELOG entry, or is empty", () => {
    for (const hotfixReason of ["sign-in loop after the upgrade", "  "]) {
      const verdict = decideReleaseSoak({
        lastTag: LAST,
        now: hoursAfter(2),
        hotfixReason,
        section: "\n- Fixed it.\n",
      });
      expect(verdict.allowed).toBe(false);
    }
  });
});

describe("lastReleaseTag and changelogSection", () => {
  it("takes the newest release tag other than the one being made", () => {
    const refs = [
      "v1.3.0 1900000000",
      "v1.4.0 1950000000",
      "not-a-release 1990000000",
      "v1.5.0 1999999999",
    ].join("\n");
    expect(lastReleaseTag(refs, "v1.5.0")).toEqual({
      name: "v1.4.0",
      taggedAt: new Date(1950000000 * 1000),
    });
    expect(lastReleaseTag("", "v1.5.0")).toBeNull();
  });

  it("reads one version's section up to the next heading", () => {
    const changelog =
      "# Changelog\n\n## 1.5.0 (2031-03-01)\n\n- Hotfix: x\n\n## 1.4.0\n\n- older\n";
    expect(changelogSection(changelog, "1.5.0")).toBe("\n- Hotfix: x\n");
    expect(changelogSection(changelog, "9.9.9")).toBe("");
  });
});

describe("the script, against a throwaway repo", () => {
  let dir = "";
  const script = path.resolve("scripts/release-soak.ts");

  function git(...args: string[]) {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }

  const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  function soak(...args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("VITEST")) delete env[key];
    return spawnSync(TSX, [script, ...args], {
      cwd: dir,
      encoding: "utf8",
      env,
      timeout: 60_000,
    });
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-release-soak-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.writeFileSync(
      path.join(dir, "CHANGELOG.md"),
      "# Changelog\n\n## 1.5.0\n\n- Hotfix: invented reason\n",
    );
    git("add", "CHANGELOG.md");
    git("commit", "-q", "-m", "release");
    // An annotated tag made just now: the soak window is open.
    git("tag", "-a", "v1.4.0", "-m", "v1.4.0");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses within the window, naming the last tag", () => {
    const result = soak("1.5.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("v1.4.0 was tagged");
  });

  it("passes a hotfix whose reason the CHANGELOG entry carries", () => {
    const result = soak("1.5.0", "--hotfix", "invented reason");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Hotfix");
  });
});

describe("release.sh", () => {
  const release = fs.readFileSync("scripts/release.sh", "utf8");

  it("runs the soak gate, passing --hotfix through, before it tags", () => {
    const gate = release.indexOf("npx tsx scripts/release-soak.ts");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(release.indexOf('git tag -a "$TAG"'));
    expect(release).toContain('SOAK_ARGS+=(--hotfix "$HOTFIX_REASON")');
  });
});
