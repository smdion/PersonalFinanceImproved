/**
 * `zCalendarDate` accepts exactly the `YYYY-MM-DD` shape: any four, two and
 * two digits, with no check that the day exists.
 */
import { describe, it, expect } from "vitest";
import { zCalendarDate } from "@/lib/utils/zod-fields";

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const CASES = [
  "2026-11-05",
  "2026-02-30",
  "2026-13-45",
  "0002-01-09",
  "9999-99-99",
  "2026-1-05",
  "26-11-05",
  "20261-01-01",
  "2026-11-05T00:00:00.000Z",
  " 2026-11-05",
  "2026-11-05\n",
  "2026/11/05",
  "",
];

describe("zCalendarDate", () => {
  it.each(CASES)("%j is accepted only when it has the shape", (value) => {
    expect(zCalendarDate.safeParse(value).success).toBe(SHAPE.test(value));
  });

  it("refuses a non-string", () => {
    expect(zCalendarDate.safeParse(20261105).success).toBe(false);
    expect(zCalendarDate.safeParse(null).success).toBe(false);
  });

  it("keeps a nullable field's null", () => {
    expect(zCalendarDate.nullable().parse(null)).toBeNull();
  });
});
