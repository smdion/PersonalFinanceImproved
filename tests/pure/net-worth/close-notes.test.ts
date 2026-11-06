/**
 * The Current Balances card's notes on its daily changes: "not in yet"
 * only while the latest close's report can still come; a report that never
 * came is named by its days.
 */
import { describe, it, expect } from "vitest";
import {
  gapLines,
  missingNote,
  missingReason,
} from "@/lib/pure/net-worth/close-notes";

// Oct 29 (Thu), Oct 30 (Fri), Nov 2 (Mon) … Nov 5 (Thu): the card's window.
const DAYS = [
  "2026-10-29",
  "2026-10-30",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
];
const TARGET = "2026-11-05";

/** A report for `name` with no value on `gone` days. */
const report = (
  name: string,
  gone: readonly string[],
  gaps: {
    before: string;
    after: string;
    missing: string[];
    move: number;
  }[] = [],
) => ({
  name,
  closes: DAYS.map((day) => ({ day, valued: !gone.includes(day) })),
  gaps,
});

// No reports for Nov 2–4; Nov 5 came in.
const voyaGap = report(
  "Voya",
  ["2026-11-02", "2026-11-03", "2026-11-04"],
  [
    {
      before: "2026-10-30",
      after: "2026-11-05",
      missing: ["2026-11-02", "2026-11-03", "2026-11-04"],
      move: -5821.75,
    },
  ],
);

describe("missingNote", () => {
  it("the end close is in, the start never came: names the missing days", () => {
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voyaGap])).toBe("no Voya report Nov 2–4");
  });

  it("one missing day is named alone", () => {
    const voya = report("Voya", ["2026-11-04"]);
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voya])).toBe("no Voya report Nov 4");
  });

  it("the latest close's report not in yet stays 'not in yet'", () => {
    const voya = report("Voya", ["2026-11-05"]);
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voya])).toBe("Voya change not in yet");
  });

  it("an older close missing its end close is named by the run", () => {
    const c = { day: "2026-11-02", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voyaGap])).toBe("no Voya report Nov 2–4");
  });

  it("a run across a month end names both months", () => {
    const voya = report("Voya", ["2026-10-30", "2026-11-02"]);
    const c = { day: "2026-11-03", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voya])).toBe("no Voya report Oct 30–Nov 2");
  });

  it("the latest close with neither close in names what's missing", () => {
    const voya = report("Voya", ["2026-11-04", "2026-11-05"]);
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingNote(c, TARGET, [voya])).toBe("no Voya report Nov 4–5");
  });

  it("two institutions with the same days are joined", () => {
    const c = { day: "2026-11-05", missing: ["Fidelity Investments", "Voya"] };
    const reports = [
      report("Fidelity Investments", ["2026-11-04"]),
      report("Voya", ["2026-11-04"]),
    ];
    expect(missingNote(c, TARGET, reports)).toBe(
      "no Fidelity and Voya report Nov 4",
    );
  });

  it("two institutions for different reasons each get their own note", () => {
    const c = { day: "2026-11-05", missing: ["Fidelity Investments", "Voya"] };
    const reports = [report("Fidelity Investments", ["2026-11-05"]), voyaGap];
    expect(missingNote(c, TARGET, reports)).toBe(
      "Fidelity change not in yet · no Voya report Nov 2–4",
    );
  });

  it("without closes to tell why, the wording stays as before", () => {
    expect(
      missingNote({ day: TARGET, missing: ["Fidelity", "Voya"] }, TARGET, []),
    ).toBe("Fidelity and Voya changes not in yet");
    expect(
      missingNote({ day: "2026-11-03", missing: ["Voya"] }, TARGET, []),
    ).toBe("excludes Voya");
    expect(missingNote({ day: TARGET, missing: [] }, TARGET, [])).toBeNull();
  });
});

describe("missingReason", () => {
  it("says which report never came", () => {
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingReason(c, TARGET, [voyaGap])).toBe(
      "Voya sent no report for Nov 2–4, so its change isn't in this total.",
    );
  });

  it("the latest close's report still to come keeps its reason", () => {
    const c = { day: "2026-11-05", missing: ["Voya"] };
    expect(missingReason(c, TARGET, [report("Voya", ["2026-11-05"])])).toBe(
      "Voya's Nov 5 balance is in; the change needs its Nov 5 fund prices, which arrive with the next sync. This total leaves it out until then.",
    );
  });
});

describe("gapLines", () => {
  it("one line per run: the move from the close before to the close after", () => {
    expect(gapLines([voyaGap])).toEqual([
      "Voya: −$5,821.75 Oct 30 → Nov 5 (no daily reports Nov 2–4)",
    ]);
  });

  it("one missing day, a gain", () => {
    const voya = report(
      "Voya Financial",
      ["2026-11-04"],
      [
        {
          before: "2026-11-03",
          after: "2026-11-05",
          missing: ["2026-11-04"],
          move: 120.5,
        },
      ],
    );
    expect(gapLines([voya])).toEqual([
      "Voya: +$120.50 Nov 3 → Nov 5 (no daily report Nov 4)",
    ]);
  });

  it("no gap, no line", () => {
    expect(gapLines([report("Voya", ["2026-11-05"])])).toEqual([]);
  });
});
