import { sumBy } from "@/lib/utils/math";

/** Holds each limit group's IRA rows (`bounded`) to taxable compensation. */
export function holdIraRowsToCompensation(
  bounded: Map<string, number[]>,
  spousal: boolean,
  compensation: Map<number, number | null>,
  rows: readonly { personId: number | null }[],
  holdTo: (index: readonly number[], room: number) => void,
): void {
  for (const index of bounded.values()) {
    if (spousal) {
      // Everyone's compensation counts, IRA or not — usually only the
      // spouse without pay contributes. Unknown for anyone = no bound.
      const comps = [...compensation.values()];
      if (comps.every((c) => c !== null))
        holdTo(
          index,
          sumBy(comps, (c) => c!),
        );
      continue;
    }
    for (const pid of new Set(index.map((i) => rows[i]!.personId!))) {
      const comp = compensation.get(pid) ?? null;
      if (comp !== null)
        holdTo(
          index.filter((i) => rows[i]!.personId === pid),
          comp,
        );
    }
  }
}
