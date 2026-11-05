/**
 * scripts/ci-gate.ts: whether a commit has a green CI run, the check
 * scripts/deploy.sh makes before it builds. The decision is tested with
 * invented runs; the script and deploy.sh --dry-run run for real (child
 * processes) with a stand-in `gh` on PATH, so nothing reaches GitHub.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  decideCiGate,
  newestPushRun,
  workflowJobNames,
  WORKFLOW_FILE,
  type CiJob,
  type CiRun,
} from "../../scripts/ci-gate";

const SHA = "a".repeat(40);
const REQUIRED = ["ci", "PostgreSQL"];

function pushRun(over: Partial<CiRun> = {}): CiRun {
  return {
    databaseId: 1,
    headSha: SHA,
    event: "push",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-11-03T20:00:00Z",
    ...over,
  };
}

const greenJobs: CiJob[] = [
  { name: "ci", status: "completed", conclusion: "success" },
  { name: "PostgreSQL", status: "completed", conclusion: "success" },
];

function decide(runs: CiRun[], jobs: CiJob[] = greenJobs) {
  return decideCiGate({ sha: SHA, runs, jobs, requiredJobs: REQUIRED });
}

function reason(result: ReturnType<typeof decide>): string {
  if (result.green) throw new Error(`expected a refusal: ${result.message}`);
  return result.reason;
}

describe("workflowJobNames", () => {
  it("lists every job of ci.yml, the PostgreSQL job included", () => {
    const names = workflowJobNames(fs.readFileSync(WORKFLOW_FILE, "utf8"));
    expect(names).toEqual(expect.arrayContaining(["ci", "PostgreSQL"]));
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses a job's name when it has one, else its key; ignores step names", () => {
    const yaml = [
      "name: CI",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Step name, not a job",
      "        run: echo",
      "  postgres:",
      '    name: "PostgreSQL" # display name',
      "    runs-on: ubuntu-latest",
      "  # a comment",
      "  lint: # trailing comment",
      "    name: 'Lint'",
      "env:",
      "  notajob:",
      "    name: nope",
    ].join("\n");
    expect(workflowJobNames(yaml)).toEqual(["build", "PostgreSQL", "Lint"]);
  });
});

describe("decideCiGate", () => {
  it("refuses a commit with no CI run", () => {
    expect(reason(decide([]))).toMatch(/No CI run for aaaaaaaa/);
  });

  it("refuses runs of another commit", () => {
    expect(reason(decide([pushRun({ headSha: "b".repeat(40) })]))).toMatch(
      /No CI run/,
    );
  });

  it("refuses a commit with only pull-request runs: the boot test runs on pushes", () => {
    expect(reason(decide([pushRun({ event: "pull_request" })]))).toMatch(
      /only pull_request CI runs.*push run/,
    );
  });

  it("refuses while CI is still running", () => {
    expect(
      reason(decide([pushRun({ status: "in_progress", conclusion: "" })])),
    ).toMatch(/still in progress/);
  });

  it.each(["failure", "cancelled", "timed_out"])(
    'refuses a run that concluded "%s"',
    (conclusion) => {
      expect(reason(decide([pushRun({ conclusion })]))).toContain(
        `concluded "${conclusion}"`,
      );
    },
  );

  it("judges the newest push run: a later red run beats an earlier green one", () => {
    const runs = [
      pushRun({ databaseId: 1, createdAt: "2026-11-03T20:00:00Z" }),
      pushRun({
        databaseId: 2,
        createdAt: "2026-11-03T21:00:00Z",
        conclusion: "failure",
      }),
    ];
    expect(newestPushRun(runs, SHA)?.databaseId).toBe(2);
    expect(reason(decide(runs))).toMatch(/concluded "failure"/);
  });

  it("refuses a green run that lacks a required job (a run from before the PostgreSQL job)", () => {
    const jobs: CiJob[] = [
      { name: "ci", status: "completed", conclusion: "success" },
      { name: "postgres-demo", status: "completed", conclusion: "success" },
    ];
    expect(reason(decide([pushRun()], jobs))).toMatch(/no "PostgreSQL" job/);
  });

  it("refuses a skipped or failed required job", () => {
    for (const conclusion of ["skipped", "failure"]) {
      const jobs: CiJob[] = [
        greenJobs[0]!,
        { name: "PostgreSQL", status: "completed", conclusion },
      ];
      expect(reason(decide([pushRun()], jobs))).toContain(
        `"PostgreSQL" for aaaaaaaa is "${conclusion}"`,
      );
    }
  });

  it("refuses when the workflow defines no jobs", () => {
    const result = decideCiGate({
      sha: SHA,
      runs: [pushRun()],
      jobs: greenJobs,
      requiredJobs: [],
    });
    expect(reason(result)).toMatch(/No jobs found/);
  });

  it("passes when the newest push run and every required job are green", () => {
    const runs = [pushRun(), pushRun({ databaseId: 9, event: "pull_request" })];
    const result = decide(runs);
    expect(result.green).toBe(true);
    if (result.green) expect(result.message).toMatch(/ci, PostgreSQL/);
  });

  it("counts matrix legs of a required job, all of which must be green", () => {
    const jobs: CiJob[] = [
      greenJobs[0]!,
      { name: "PostgreSQL (16)", status: "completed", conclusion: "success" },
      { name: "PostgreSQL (17)", status: "completed", conclusion: "failure" },
    ];
    expect(reason(decide([pushRun()], jobs))).toContain("PostgreSQL (17)");
  });
});

describe("the script and deploy.sh --dry-run, with a stand-in gh", () => {
  let dir: string;
  let head: string;
  const version = (
    JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string }
  ).version;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-ci-gate-"));
    head = spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    // `gh run list …` prints runs.json, `gh run view …` jobs.json;
    // FAKE_GH_FAIL makes every call fail as an unauthenticated gh would.
    const gh = path.join(dir, "gh");
    fs.writeFileSync(
      gh,
      [
        "#!/usr/bin/env bash",
        'if [ -n "${FAKE_GH_FAIL:-}" ]; then echo "gh: not logged in" >&2; exit 4; fi',
        'case "$2" in',
        '  list) cat "$FAKE_GH_DIR/runs.json" ;;',
        '  view) cat "$FAKE_GH_DIR/jobs.json" ;;',
        "  *) exit 3 ;;",
        "esac",
      ].join("\n"),
    );
    fs.chmodSync(gh, 0o755);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function stage(runs: Partial<CiRun>[], jobs: CiJob[] = greenJobs) {
    fs.writeFileSync(
      path.join(dir, "runs.json"),
      JSON.stringify(runs.map((r) => pushRun({ headSha: head, ...r }))),
    );
    fs.writeFileSync(path.join(dir, "jobs.json"), JSON.stringify({ jobs }));
  }

  function run(
    cmd: string,
    args: string[],
    extra: Record<string, string> = {},
  ) {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    for (const key of Object.keys(env))
      if (key.startsWith("VITEST")) delete env[key];
    env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    env.FAKE_GH_DIR = dir;
    const result = spawnSync(cmd, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
      timeout: 60_000,
    });
    return { status: result.status, out: result.stdout + result.stderr };
  }

  const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const gate = (extra?: Record<string, string>) =>
    run(TSX, ["scripts/ci-gate.ts", "HEAD"], extra);
  const deployDryRun = (...flags: string[]) =>
    run("bash", ["scripts/deploy.sh", version, "--dry-run", ...flags]);

  it("exits 0 for a green run of HEAD", () => {
    stage([{}]);
    const { status, out } = gate();
    expect(out).toMatch(/CI is green/);
    expect(status).toBe(0);
  });

  it("exits 1 with no run for HEAD, and for a red one", () => {
    stage([]);
    expect(gate()).toMatchObject({ status: 1 });
    stage([{ conclusion: "failure" }]);
    const red = gate();
    expect(red.status).toBe(1);
    expect(red.out).toMatch(/concluded "failure"/);
  });

  it("exits 2 when gh can't answer", () => {
    stage([{}]);
    const { status, out } = gate({ FAKE_GH_FAIL: "1" });
    expect(out).toMatch(/Couldn't check CI.*not logged in/s);
    expect(status).toBe(2);
  });

  it("deploy.sh --dry-run refuses without a green run", () => {
    stage([{ conclusion: "failure" }]);
    const { status, out } = deployDryRun();
    expect(out).toMatch(/Refusing to deploy/);
    expect(out).not.toMatch(/Dry run: the checks passed/);
    expect(status).toBe(1);
  });

  it("deploy.sh --dry-run --force still refuses a red run", () => {
    stage([{ conclusion: "failure" }]);
    const { status, out } = deployDryRun("--force");
    expect(out).toMatch(/Refusing to deploy/);
    expect(status).toBe(1);
  });

  it("deploy.sh --dry-run --skip-ci-gate proceeds past a red run with a warning", () => {
    stage([{ conclusion: "failure" }]);
    // --force too: a working tree with uncommitted changes (a gate run) is
    // its own refusal, and --skip-ci-gate doesn't lift it.
    const { status, out } = deployDryRun("--skip-ci-gate", "--force");
    expect(out).toMatch(
      /WARNING: --skip-ci-gate: deploying \w+ WITHOUT a green CI run/,
    );
    expect(out).toMatch(/Dry run: the checks passed; stopping before SSH/);
    expect(status).toBe(0);
  });
});
