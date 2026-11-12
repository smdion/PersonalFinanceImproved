/** A drizzle journal's entries must have strictly rising `when` values: the migrator records
 *  each migration's `when`, and a repeat or a step back could let one run twice. */
export function nonRisingWhen(
  entries: readonly { tag: string; when: number }[],
): string[] {
  return entries
    .filter((e, i) => i > 0 && !(e.when > entries[i - 1]!.when))
    .map((e) => e.tag);
}
