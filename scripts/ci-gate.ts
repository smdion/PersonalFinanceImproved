/**
 * Whether a commit has a green CI run, for scripts/deploy.sh: a deploy of a
 * commit CI never passed is refused (`--force` overrides it with a warning).
 *
 * Green means the newest push run of the CI workflow (.github/workflows/
 * ci.yml) for exactly that commit has completed with success, and every job
 * that commit's ci.yml defines (today `ci` and `PostgreSQL`) ran and
 * succeeded. Push runs only: the image build and the compose boot test run
 * on pushes, not on pull requests. Jobs come from the commit's own ci.yml,
 * so a job added later is required from the commit that adds it.
 *
 * Usage: pnpm tsx scripts/ci-gate.ts [<sha>]   (default: HEAD)
 * Exit 0: green. 1: not green (the reason is printed). 2: couldn't check
 * (gh missing or not signed in, no ci.yml at that commit).
 * Reads only: `gh run list`, `gh run view`, `git show`.
 */
import { spawnSync } from "node:child_process";

export const WORKFLOW_FILE = ".github/workflows/ci.yml";

export interface CiRun {
  databaseId: number;
  headSha: string;
  event: string;
  status: string;
  conclusion: string;
  createdAt: string;
  url?: string;
}

export interface CiJob {
  name: string;
  status: string;
  conclusion: string;
}

export type GateResult =
  { green: true; message: string } | { green: false; reason: string };

/**
 * The job names a workflow file defines, as GitHub reports them: a job's
 * `name:` when it has one, else its key. Reads only the `jobs:` block's
 * two-space keys and their four-space `name:` lines.
 */
export function workflowJobNames(workflowYaml: string): string[] {
  const names: string[] = [];
  let inJobs = false;
  let current: { key: string; name: string | null } | null = null;
  const flush = () => {
    if (current) names.push(current.name ?? current.key);
    current = null;
  };
  for (const raw of workflowYaml.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) {
      flush();
      inJobs = /^jobs:\s*$/.test(line);
      continue;
    }
    if (!inJobs) continue;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) {
      flush();
      current = { key: key[1]!, name: null };
      continue;
    }
    const name = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (name && current && current.name === null)
      current.name = name[1]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  flush();
  return names;
}

/** The newest push run for the commit, or null when it has none. */
export function newestPushRun(runs: CiRun[], sha: string): CiRun | null {
  const pushes = runs
    .filter((r) => r.event === "push" && r.headSha === sha)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return pushes[0] ?? null;
}

/**
 * The decision. `runs` are the CI workflow's runs for the commit; `jobs`
 * are the jobs of `newestPushRun(runs, sha)` (unused when it has none).
 */
export function decideCiGate(input: {
  sha: string;
  runs: CiRun[];
  jobs: CiJob[];
  requiredJobs: string[];
}): GateResult {
  const { sha, runs, jobs, requiredJobs } = input;
  const short = sha.slice(0, 8);
  const forCommit = runs.filter((r) => r.headSha === sha);
  if (forCommit.length === 0)
    return {
      green: false,
      reason: `No CI run for ${short}. Push the commit and wait for CI to pass.`,
    };
  const run = newestPushRun(forCommit, sha);
  if (!run)
    return {
      green: false,
      reason: `${short} has only ${[...new Set(forCommit.map((r) => r.event))].join(", ")} CI runs. Deploy needs a push run: the image build and boot test run on pushes only.`,
    };
  const where = run.url ?? `run ${run.databaseId}`;
  if (run.status !== "completed")
    return {
      green: false,
      reason: `CI for ${short} is still ${run.status.replace(/_/g, " ")} (${where}). Wait for it to finish.`,
    };
  if (run.conclusion !== "success")
    return {
      green: false,
      reason: `CI for ${short} concluded "${run.conclusion}" (${where}).`,
    };
  if (requiredJobs.length === 0)
    return {
      green: false,
      reason: `No jobs found in ${WORKFLOW_FILE} at ${short}; can't tell what green means.`,
    };
  for (const required of requiredJobs) {
    // A matrix job reports as "<name> (<values>)".
    const matching = jobs.filter(
      (j) => j.name === required || j.name.startsWith(`${required} (`),
    );
    if (matching.length === 0)
      return {
        green: false,
        reason: `CI for ${short} has no "${required}" job (${where}).`,
      };
    const bad = matching.find(
      (j) => j.status !== "completed" || j.conclusion !== "success",
    );
    if (bad)
      return {
        green: false,
        reason: `CI job "${bad.name}" for ${short} is ${bad.status === "completed" ? `"${bad.conclusion}"` : bad.status} (${where}).`,
      };
  }
  return {
    green: true,
    message: `CI is green for ${short}: ${requiredJobs.join(", ")} (${where}).`,
  };
}

class CheckError extends Error {}

function run(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error)
    throw new CheckError(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0)
    throw new CheckError(
      `${cmd} ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`,
    );
  return result.stdout;
}

function main(): void {
  const sha = run("git", [
    "rev-parse",
    "--verify",
    `${process.argv[2] ?? "HEAD"}^{commit}`,
  ]).trim();
  const requiredJobs = workflowJobNames(
    run("git", ["show", `${sha}:${WORKFLOW_FILE}`]),
  );
  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--commit",
      sha,
      "--workflow",
      "ci.yml",
      "--limit",
      "50",
      "--json",
      "databaseId,headSha,event,status,conclusion,createdAt,url",
    ]),
  ) as CiRun[];
  const newest = newestPushRun(runs, sha);
  const jobs = newest
    ? (
        JSON.parse(
          run("gh", [
            "run",
            "view",
            String(newest.databaseId),
            "--json",
            "jobs",
          ]),
        ) as { jobs: CiJob[] }
      ).jobs
    : [];
  const result = decideCiGate({ sha, runs, jobs, requiredJobs });
  if (result.green) {
    console.log(result.message);
    return;
  }
  console.error(result.reason);
  process.exit(1);
}

// Importable by tests without running the check.
if (!process.env.VITEST) {
  try {
    main();
  } catch (err) {
    console.error(
      `Couldn't check CI: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}
