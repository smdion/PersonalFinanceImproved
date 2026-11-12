/**
 * A known-list entry a path-rename commit renamed: its key (a procedure
 * path, or a glob like `*\/area.listRows`) follows the commit's
 * `Rename-path:` pairs, and its value stays. check-ratchets excuses such
 * an entry only when check-commit proves the commit.
 */
import { listEntries } from "./code-limits";
import type { Rise } from "./rise";

const DOTTED = /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g;

/** `text` with every dotted path under an old prefix moved to its new one. */
export function renamedPaths(
  text: string,
  pairs: readonly (readonly [string, string])[],
): string {
  return text.replace(DOTTED, (token) => {
    for (const [from, to] of pairs)
      if (token === from || token.startsWith(`${from}.`))
        return to + token.slice(from.length);
    return token;
  });
}

const squeeze = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The old entry an added list entry renames, or undefined: an entry of the
 * parent, gone in the commit, whose key the pairs map to the added one,
 * with the same count and the same value (renamed by the pairs too).
 */
export function renamedListEntry(
  rise: Rise,
  pairs: readonly (readonly [string, string])[],
  was: string | undefined,
  now: string | undefined,
): string | undefined {
  if (rise.by !== undefined || !rise.text.endsWith(": added")) return undefined;
  if (was === undefined || now === undefined) return undefined;
  const entry = rise.id.slice(rise.file.length + 1);
  const [wasValues, nowValues] = [
    new Map<string, string>(),
    new Map<string, string>(),
  ];
  const before = listEntries(rise.file, was, wasValues);
  const after = listEntries(rise.file, now, nowValues);
  if (before.has(entry)) return undefined;
  const old = [...before.keys()].find(
    (key) => !after.has(key) && renamedPaths(key, pairs) === entry,
  );
  if (old === undefined) return undefined;
  if (before.get(old) !== after.get(entry)) return undefined;
  const value = (map: Map<string, string>, key: string) =>
    squeeze(map.get(key) ?? "");
  if (renamedPaths(value(wasValues, old), pairs) !== value(nowValues, entry))
    return undefined;
  return old;
}
