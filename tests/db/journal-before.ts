/**
 * A journal's text cut before a tag: a test of an older tag runs the tags
 * up to the stored-JSON tag, which refuses some of its fixture's shapes by
 * design (tested in that tag's own files).
 */
export function journalBefore(text: string, tag: string): string {
  const journal = JSON.parse(text) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === tag);
  if (at < 0) throw new Error(`The journal has no ${tag}`);
  journal.entries.splice(at);
  return JSON.stringify(journal, null, 2);
}
