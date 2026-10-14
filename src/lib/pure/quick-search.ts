/**
 * Quick search matching — every word typed must appear in a page's label,
 * group or keywords. Labels that start with the query rank first.
 */
export type SearchEntry = {
  href: string;
  label: string;
  group: string | null;
  keywords: readonly string[];
};

export function searchPages(
  entries: readonly SearchEntry[],
  query: string,
  limit = 8,
): SearchEntry[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries.slice(0, limit);
  const scored = entries
    .map((e) => {
      const haystack = [e.label, e.group ?? "", ...e.keywords]
        .join(" ")
        .toLowerCase();
      if (!words.every((w) => haystack.includes(w))) return null;
      const label = e.label.toLowerCase();
      const score = label.startsWith(words[0]!)
        ? 0
        : label.includes(words[0]!)
          ? 1
          : 2;
      return { e, score };
    })
    .filter((x): x is { e: SearchEntry; score: number } => x !== null)
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.e);
}
