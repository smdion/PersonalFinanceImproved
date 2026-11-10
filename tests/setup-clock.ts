/**
 * Every test starts at the same "now", not the real clock.
 *
 * Code that reads `new Date()` (this year's tax data, YTD pay periods, the
 * household month, ages) gave a commit different results on different
 * days: on Jan 1 every router test that reaches this year's tax data
 * would have needed next year's file. So `Date` is shifted: a test file
 * starts at TEST_NOW and the clock runs from there at the real clock's
 * pace, to the millisecond (synchronous work still sees time pass, so two
 * timestamped files written back to back keep different names). Timers
 * aren't touched.
 *
 * A test that fakes timers itself (`vi.useFakeTimers()`) replaces this
 * clock with its own; `vi.useRealTimers()` hands back this one, and when
 * vitest puts the real `Date` back instead (after `vi.setSystemTime`
 * without fake timers), the next test starts on this clock again.
 *
 * `LEDGR_TEST_NOW` (an ISO instant) moves the start: `pnpm test:year-end`
 * runs the date-heavy files at 23:30 Chicago on Dec 31 and 00:30 on Jan 1
 * (nightly in `.github/workflows/year-end-clock.yml`). Moving TEST_NOW
 * itself is a deliberate commit that says why (and moves the year-end
 * instants with it).
 */
import { beforeEach, vi } from "vitest";

const TEST_NOW = "2026-11-10T17:00:00.000Z";

const RealDate = Date;

function startInstant(): number {
  const at = process.env.LEDGR_TEST_NOW ?? TEST_NOW;
  const ms = RealDate.parse(at);
  if (!Number.isFinite(ms))
    throw new Error(`LEDGR_TEST_NOW isn't an instant: "${at}"`);
  return ms;
}

const offset = startInstant() - RealDate.now();
const now = () => RealDate.now() + offset;

/** `Date` with "now" shifted; every other use is the real `Date`'s. */
const ShiftedDate = function (this: unknown, ...args: unknown[]) {
  if (!new.target) return new RealDate(now()).toString();
  return args.length === 0
    ? new RealDate(now())
    : new (RealDate as new (...a: unknown[]) => Date)(...args);
  // eslint-disable-next-line no-restricted-syntax -- a function standing in for the Date constructor: no typed wrapper says "callable and newable"
} as unknown as DateConstructor;
Object.setPrototypeOf(ShiftedDate, RealDate);
// Plain writable properties, as on the real Date: fake-timer libraries copy
// and reassign them.
Object.assign(ShiftedDate, {
  prototype: RealDate.prototype,
  now,
  parse: RealDate.parse,
  UTC: RealDate.UTC,
});

function startShiftedClock(): void {
  globalThis.Date = ShiftedDate;
}

// At load, so a file's top level and beforeAll see TEST_NOW too.
startShiftedClock();

beforeEach(() => {
  if (!vi.isFakeTimers() && globalThis.Date === RealDate) startShiftedClock();
});
