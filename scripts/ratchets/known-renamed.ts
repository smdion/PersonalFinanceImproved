/**
 * `Known-renamed:` trailers: a known-list entry whose key changes in a
 * commit, with nothing else about it changing, is the same entry.
 *
 *   Known-renamed: <ratchet file> — <path> <oldName> => <path> <newName>
 *
 * It excuses the new key in that commit only when the old key is gone and
 * the new key appears, the path is the same or follows a rename in that
 * commit, the count is the same, and nothing else in that list rose.
 */
import { trailerValues } from "../check-commit";
import type { Rise } from "./rise";

export const KNOWN_RENAMED = "Known-renamed";

export type KnownRename = {
  file: string;
  from: string;
  to: string;
  value: string;
};

/** The trailer's renames, and a problem for each line not in its form. */
export function readKnownRenamed(message: string): {
  renames: KnownRename[];
  problems: string[];
} {
  const renames: KnownRename[] = [];
  const problems: string[] = [];
  for (const value of trailerValues(message, KNOWN_RENAMED)) {
    const match = /^(\S+)\s+(?:—|--)\s+(.+?)\s+=>\s+(.+)$/.exec(value);
    if (!match) {
      problems.push(
        `"${KNOWN_RENAMED}: ${value}": write ${KNOWN_RENAMED}: <ratchet file> — <path> <oldName> => <path> <newName>`,
      );
      continue;
    }
    renames.push({
      file: match[1]!,
      from: match[2]!.trim(),
      to: match[3]!.trim(),
      value,
    });
  }
  return { renames, problems };
}

type Entries = Map<string, number | undefined>;

/** `LIST › key` → [`LIST`, `key`]. */
const split = (entry: string): [string, string] => {
  const at = entry.indexOf(" › ");
  return [entry.slice(0, at), entry.slice(at + 3)];
};
const pathOf = (key: string) => key.split(" ")[0] ?? "";

/**
 * The list rises a commit's `Known-renamed:` trailers excuse (by rise id),
 * and a problem for each trailer the commit doesn't bear out.
 * `entries(file)` gives a list file's entries at the commit's parent and at
 * the commit; `renamed` maps each path the commit renamed to its old path.
 */
export function knownRenamed(
  renames: KnownRename[],
  rises: Rise[],
  entries: (file: string) => { was: Entries; now: Entries },
  renamed: Map<string, string>,
): { excused: Map<string, KnownRename>; problems: string[] } {
  const excused = new Map<string, KnownRename>();
  const problems: string[] = [];
  const lists = new Map<string, Set<string>>();
  for (const rename of renames) {
    const fail = (why: string) =>
      problems.push(`"${KNOWN_RENAMED}: ${rename.value}": ${why}`);
    const { was, now } = entries(rename.file);
    const olds = [...was.keys()].filter((e) => split(e)[1] === rename.from);
    const news = [...now.keys()].filter((e) => split(e)[1] === rename.to);
    const old = olds[0];
    const added = news[0];
    if (olds.length !== 1 || !old) {
      fail(
        `${rename.from} is not one entry of ${rename.file} before this commit`,
      );
      continue;
    }
    if (now.has(old)) {
      fail(`${rename.from} is still in ${rename.file}`);
      continue;
    }
    if (news.length !== 1 || !added || was.has(added)) {
      fail(`${rename.to} is not one new entry of ${rename.file}`);
      continue;
    }
    const [list] = split(old);
    if (split(added)[0] !== list) {
      fail(`${rename.to} is in another list than ${rename.from}`);
      continue;
    }
    const [fromPath, toPath] = [pathOf(rename.from), pathOf(rename.to)];
    if (fromPath !== toPath && renamed.get(toPath) !== fromPath) {
      fail(`${toPath} is neither ${fromPath} nor its rename in this commit`);
      continue;
    }
    if (was.get(old) !== now.get(added)) {
      fail(`the count changed (${was.get(old)} → ${now.get(added)})`);
      continue;
    }
    const id = rises.find(
      (r) => r.file === rename.file && r.id === `${rename.file}\0${added}`,
    )?.id;
    if (id === undefined) {
      fail(`${rename.to} did not rise`);
      continue;
    }
    excused.set(id, rename);
    const key = `${rename.file}\0${list}`;
    lists.set(key, (lists.get(key) ?? new Set()).add(id));
  }
  // Nothing else in a renamed entry's list may rise in the same commit.
  for (const [key, ids] of lists) {
    const [file, list] = key.split("\0") as [string, string];
    const others = rises.filter(
      (r) =>
        r.file === file &&
        !ids.has(r.id) &&
        split(r.id.slice(file.length + 1))[0] === list,
    );
    if (others.length === 0) continue;
    for (const id of ids) {
      const rename = excused.get(id)!;
      excused.delete(id);
      problems.push(
        `"${KNOWN_RENAMED}: ${rename.value}": another entry of ${list} rose in this commit (${others.map((r) => r.text).join("; ")})`,
      );
    }
  }
  return { excused, problems };
}
