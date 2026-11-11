/**
 * Money already in a limit group this year: rows of a job that ended before the date, never cut
 * for the rows still being paid, and an HSA limit held to the months it covers.
 */
import { sumBy } from "@/lib/utils/math";
import type { CapPerson, CapRow } from "./contribution-caps.types";

/** Every month of the year, as a covered-months mask. */
const WHOLE_YEAR = 0xfff;

/** A row of a job that ended before the date: its money is already in. */
export const isAlreadyIn = (r: CapRow) => r.employer?.ended === true;

/** The share of a year's limit for the months in `mask` (bit 0 = January). */
function monthShare(mask: number): number {
  let months = 0;
  for (let m = 0; m < 12; m++) if (mask & (1 << m)) months++;
  return months / 12;
}

type Size = { base: number; catchup: number };

/** A limit held to the months an HSA covers (IRC 223(b)(2)): the catch-up at the person's own
 *  months; the base at theirs, or on a shared family limit (223(b)(5)) at the months any spouse
 *  with HSA rows is covered (everyone's when only joint rows hold it). No coverage variant: as is. */
export function monthsFor(
  coverageMatters: boolean,
  sharedFamily: boolean,
  people: readonly CapPerson[],
  byPerson: ReadonlyMap<number, unknown>,
) {
  const family =
    byPerson.size > 0 ? [...byPerson.keys()] : people.map((p) => p.id);
  const mask = (id: number) =>
    people.find((p) => p.id === id)?.coveredMonths ?? WHOLE_YEAR;
  return <Unsized extends string>(
    size: Size | Unsized,
    pid: number,
  ): Size | Unsized => {
    if (typeof size === "string" || !coverageMatters) return size;
    const base = sharedFamily ? family : [pid];
    return {
      base: size.base * monthShare(base.reduce((m, id) => m | mask(id), 0)),
      catchup: size.catchup * monthShare(mask(pid)),
    };
  };
}

/** One person's share of a limit group: the rows the pass may cut, and an ended job's money already
 *  in, counted like employer money and held on its own to their limit (`size`; over alone, it shows
 *  over). On a shared family limit (`family`) their own room is their catch-up. */
export function participantOf(
  personId: number,
  rows: readonly CapRow[],
  index: readonly number[],
  kept: number[],
  employerOf: (index: readonly number[], factor?: number) => number,
  size: Size | undefined,
  family: boolean,
) {
  const limit = size ? size.base + size.catchup : Infinity;
  const ended = index.filter((i) => isAlreadyIn(rows[i]!));
  const rowIndex = index.filter((i) => !isAlreadyIn(rows[i]!));
  const endedEmployer = ended.length > 0 ? employerOf(ended) : 0;
  const room = Math.max(0, limit - endedEmployer);
  const endedEmployee = sumBy(ended, (i) => kept[i]!);
  if (endedEmployee > room)
    for (const i of ended) kept[i] = (kept[i]! * room) / endedEmployee;
  const already = Math.min(endedEmployee, room) + endedEmployer;
  return {
    personId,
    rowIndex,
    employee: sumBy(rowIndex, (i) => kept[i]!),
    employerAt: (f: number) => employerOf(rowIndex, f) + already,
    ownRoom: family && size ? size.catchup : 0,
  };
}
