/**
 * What a `Ratchet-raise:` trailer must name to excuse a rise: one of `paths`
 * (when any are given) and, for each list in `names`, one of its words.
 */
export type Entry = { paths: string[]; names: string[][] };
/**
 * One loosened ratchet: the file that holds it, what rose, the entry's id
 * (stable across the two sides of a merge), how far a count rose (undefined:
 * an entry was added or a limit loosened) and what names the entry.
 */
export type Rise = {
  file: string;
  text: string;
  id: string;
  by?: number;
  entry: Entry;
  /** A size file rise: the files whose recorded lines were summed. */
  sized?: string[];
  /** A size file rise: every file of the commit its move or split joins. */
  joined?: string[];
};
/** A file's text at one side of the comparison (undefined: no such file). */
export type Tree = (file: string) => string | undefined;

/** A rise named by `names` alone (no path). */
export const named = (
  file: string,
  id: string,
  text: string,
  names: string[],
  by?: number,
): Rise => ({
  file,
  id: `${file}\0${id}`,
  text,
  by,
  entry: { paths: [], names: [names] },
});
