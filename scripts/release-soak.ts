/**
 * The release soak gate, for scripts/release.sh: a release less than 24
 * hours after the last release tag is refused, unless it's a hotfix whose
 * reason the version's CHANGELOG entry carries as a `Hotfix: <reason>` line.
 *
 * Usage: pnpm tsx scripts/release-soak.ts <version> [--hotfix "<reason>"]
 * Exit 0: may release (the verdict is printed). 1: refused (the reason is
 * printed). 2: couldn't check. Reads only: `git for-each-ref`, CHANGELOG.md.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const SOAK_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

export type ReleaseTag = { name: string; taggedAt: Date };

export type SoakVerdict =
  { allowed: true; message: string } | { allowed: false; reason: string };

/** The newest release tag (`vX.Y.Z`) other than `exceptTag`, by tag date
 *  (the tagger's date for an annotated tag, else its commit's). */
export function lastReleaseTag(
  refLines: string,
  exceptTag: string,
): ReleaseTag | null {
  let newest: ReleaseTag | null = null;
  for (const line of refLines.split("\n")) {
    const [name, seconds] = line.trim().split(" ");
    if (!name || !seconds || name === exceptTag) continue;
    if (!/^v\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(name)) continue;
    const taggedAt = new Date(Number(seconds) * 1000);
    if (!newest || taggedAt > newest.taggedAt) newest = { name, taggedAt };
  }
  return newest;
}

/** The CHANGELOG section for `version`: its heading line to the next `## `. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.findIndex(
    (l) => l.startsWith("## ") && l.includes(version),
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

export function decideReleaseSoak(input: {
  lastTag: ReleaseTag | null;
  now: Date;
  hotfixReason: string | null;
  section: string;
}): SoakVerdict {
  const { lastTag, now, hotfixReason, section } = input;
  if (hotfixReason !== null) {
    const reason = hotfixReason.trim();
    if (!reason) return { allowed: false, reason: "--hotfix needs a reason." };
    const line = `Hotfix: ${reason}`;
    if (
      !section
        .split("\n")
        .some((l) => l.trim().replace(/^[-*]\s+/, "") === line)
    )
      return {
        allowed: false,
        reason: `A hotfix's CHANGELOG entry carries its reason: add the line "${line}" in the release PR.`,
      };
    return {
      allowed: true,
      message: `Hotfix: the soak gate is skipped (${reason}).`,
    };
  }
  if (!lastTag)
    return {
      allowed: true,
      message: "No earlier release tag: nothing to soak.",
    };
  const hours = (now.getTime() - lastTag.taggedAt.getTime()) / HOUR_MS;
  const since = `${lastTag.name} was tagged ${lastTag.taggedAt.toISOString()}, ${hours.toFixed(1)} h ago`;
  if (hours >= SOAK_HOURS) return { allowed: true, message: `${since}.` };
  const opensAt = new Date(lastTag.taggedAt.getTime() + SOAK_HOURS * HOUR_MS);
  return {
    allowed: false,
    reason: `${since}: a release waits ${SOAK_HOURS} h (until ${opensAt.toISOString()}). A hotfix passes --hotfix "<reason>".`,
  };
}

function parseArguments(argv: string[]): {
  version: string;
  hotfixReason: string | null;
} {
  let version = "";
  let hotfixReason: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--hotfix") hotfixReason = argv[++index] ?? "";
    else if (argument && !argument.startsWith("-")) version = argument;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!version) throw new Error("no version given");
  return { version, hotfixReason };
}

function main(): void {
  const { version, hotfixReason } = parseArguments(process.argv.slice(2));
  const refs = spawnSync(
    "git",
    [
      "for-each-ref",
      "--format=%(refname:short) %(creatordate:unix)",
      "refs/tags",
    ],
    { encoding: "utf8" },
  );
  if (refs.status !== 0)
    throw new Error(refs.stderr.trim() || "git for-each-ref failed");
  const verdict = decideReleaseSoak({
    lastTag: lastReleaseTag(refs.stdout, `v${version}`),
    now: new Date(),
    hotfixReason,
    section: changelogSection(readFileSync("CHANGELOG.md", "utf8"), version),
  });
  if (verdict.allowed) {
    console.log(verdict.message);
    return;
  }
  console.error(verdict.reason);
  process.exit(1);
}

// Importable by tests without running the check.
if (!process.env.VITEST) {
  try {
    main();
  } catch (err) {
    console.error(
      `Couldn't check the soak gate: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}
