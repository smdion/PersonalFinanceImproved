/**
 * Moves and splits between the base and the head: each file whose added
 * lines mostly left one other file is joined to it, so a ratchet can sum the
 * counts of joined files instead of reading a new part as a rise.
 */

/** A file joins the file at least this share of its lines left. */
const MIN_SHARED = 0.5;

/** Lines worth matching: not blank, not an import, not punctuation. */
function significant(line: string): string | undefined {
  const t = line.trim();
  if (t.length < 12) return undefined;
  if (/^(import|export \{|export \* from|\} from|from )/.test(t))
    return undefined;
  if (/^[\s{}()[\];,]*$/.test(t)) return undefined;
  return t;
}

export type FileDiff = { added: string[]; deleted: string[] };

/** `git diff -U0 --no-renames` text → added and deleted lines per file. */
export function parseDiff(text: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let oldFile = "";
  let newFile = "";
  const entry = (file: string) => {
    let diff = files.get(file);
    if (!diff) files.set(file, (diff = { added: [], deleted: [] }));
    return diff;
  };
  let header = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      header = true;
      oldFile = newFile = "";
    } else if (line.startsWith("@@")) {
      header = false;
    } else if (header) {
      if (line.startsWith("--- "))
        oldFile = line.startsWith("--- a/") ? line.slice(6) : "";
      else if (line.startsWith("+++ "))
        newFile = line.startsWith("+++ b/") ? line.slice(6) : "";
    } else if (line.startsWith("+") && newFile) {
      entry(newFile).added.push(line.slice(1));
    } else if (line.startsWith("-") && oldFile) {
      entry(oldFile).deleted.push(line.slice(1));
    }
  }
  return files;
}

/**
 * Each file whose added lines mostly left one other file → that file.
 * `renames` (git's own pairing) wins over the line match.
 */
export function attributeMoves(
  diffs: Map<string, FileDiff>,
  renames: Map<string, string> = new Map(),
): Map<string, string> {
  const sources = new Map<string, Set<string>>();
  for (const [file, { deleted }] of diffs)
    for (const line of deleted) {
      const t = significant(line);
      if (t) (sources.get(t) ?? sources.set(t, new Set()).get(t)!).add(file);
    }
  const moves = new Map(renames);
  for (const [file, { added }] of diffs) {
    if (moves.has(file)) continue;
    const lines = new Set(added.map(significant).filter((t) => t));
    if (lines.size === 0) continue;
    const hits = new Map<string, number>();
    for (const line of lines)
      for (const source of sources.get(line!) ?? [])
        if (source !== file) hits.set(source, (hits.get(source) ?? 0) + 1);
    const [best, count] = [...hits].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (best && count! / lines.size >= MIN_SHARED) moves.set(file, best);
  }
  return moves;
}

/** Files joined by a move or split, each mapped to its group's id. */
export function groupsOf(moves: Map<string, string>): (file: string) => string {
  const parent = new Map<string, string>();
  const find = (f: string): string => {
    const p = parent.get(f) ?? f;
    if (p === f) return f;
    const root = find(p);
    parent.set(f, root);
    return root;
  };
  for (const [to, from] of moves) {
    const a = find(to);
    const b = find(from);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

/** Sums `value` over the files of each group, at one side. */
export function sumByGroup<T>(
  record: Record<string, T>,
  group: (file: string) => string,
  value: (file: string, entry: T) => number,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const [file, entry] of Object.entries(record)) {
    const g = group(file);
    sums.set(g, (sums.get(g) ?? 0) + value(file, entry));
  }
  return sums;
}

export const members = (
  files: string[],
  group: (f: string) => string,
  g: string,
) => files.filter((f) => group(f) === g).sort();
