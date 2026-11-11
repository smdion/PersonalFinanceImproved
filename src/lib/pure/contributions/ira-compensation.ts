import { sumBy } from "@/lib/utils/math";

/** Holds each limit group's IRA rows (`bounded`) to taxable compensation:
 *  own pay, and on a joint return the lower earner's spousal room. */
export function holdIraRowsToCompensation(
  bounded: Map<string, number[]>,
  spousal: boolean,
  compensation: Map<number, number | null>,
  rows: readonly { personId: number | null }[],
  holdTo: (index: readonly number[], room: number) => void,
  /** Each row's employee money as held so far (holdTo updates it). */
  kept: readonly number[],
): void {
  const comps = [...compensation];
  /** Their IRA money in the group so far (a higher earner's is already held). */
  const iraMoney = (index: readonly number[], pid: number) =>
    sumBy(index, (i) => (rows[i]!.personId === pid ? kept[i]! : 0));
  for (const index of bounded.values()) {
    // Unknown compensation for anyone on a joint return = no bound.
    if (spousal && comps.some(([, c]) => c === null)) continue;
    // Each person is held to their own pay, the higher earner first; on a
    // joint return the spouse with less pay adds the other's pay less the
    // other's IRA money (IRC 219(c)), IRA or not.
    const pids = [...new Set(index.map((i) => rows[i]!.personId!))].sort(
      (a, b) => (compensation.get(b) ?? 0) - (compensation.get(a) ?? 0),
    );
    for (const pid of pids) {
      const own = compensation.get(pid) ?? null;
      if (own === null) continue;
      const lower = spousal && comps.some(([, c]) => c! > own);
      const spouses = lower
        ? sumBy(comps, ([q, c]) =>
            q === pid ? 0 : Math.max(0, c! - iraMoney(index, q)),
          )
        : 0;
      holdTo(
        index.filter((i) => rows[i]!.personId === pid),
        own + spouses,
      );
    }
  }
}
