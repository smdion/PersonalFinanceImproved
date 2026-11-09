/**
 * Answer key, an RMD while a spouse still works (RET-05; v0.10.5 overnight
 * batch). Worked by hand from the regulations first, never read from
 * `src/`. Invented household only.
 *
 * Citations: IRC 401(a)(9)(C)(i), (v) as amended by SECURE 2.0 § 107 (the
 * required beginning age is 73 for anyone born 1951-1959); IRC
 * 408(a)(6) (IRAs follow 401(a)(9)); Treas. Reg. § 1.401(a)(9)-2(b)
 * (the still-working exception: a participant in the employer's own plan
 * may wait until retiring; it doesn't reach an IRA, and it is the
 * working person's own plan, never a spouse's); Treas. Reg.
 * § 1.401(a)(9)-5(b), (c) (the year's RMD is the prior Dec 31 balance
 * over the divisor for the owner's age that year) and § 1.401(a)(9)-9(c)
 * (Uniform Lifetime Table: 75 → 24.6; the Joint table only when the sole
 * beneficiary is a spouse more than 10 years younger, not the case here).
 * The owner's decision D5 (UD-05) adopts the same reading: the exception
 * covers the current employer's plan only.
 */
import { describe } from "vitest";
import { xfail, runOneYear } from "../../fixtures/answer-key";
import {
  engineHousehold,
  type KeyHousehold,
} from "../../fixtures/answer-key-household";

// MFJ. Person 1, born 1951, retired (a $0 job that ended in 2020), owns a
// $246,000 Traditional IRA (the plan starts 2026-01-01, so that is the
// Dec 31, 2025 balance). Person 2, born 1960 (9 years younger), works on
// at $100,000 to 2030; spending $30,000, well inside pay, so the year
// needs no draw. 0% return.
// Person 1 is 75 in 2026, past the required beginning age (73 for 1951),
// and the IRA has no still-working exception (it isn't an employer plan,
// and the one working is the spouse). RMD 246,000 / 24.6 = 10,000.00, so
// the IRA ends 2026 at 236,000.00.
// Today a gap year only warns ("a required minimum distribution falls
// due before withdrawals start"): nothing leaves the IRA, which ends at
// 246,000.00, $10,000 of required income (and its tax) missing.
const household: KeyHousehold = {
  status: "MFJ",
  people: [
    { birthYear: 1951, job: { salary: 0, lastYear: 2020 } },
    { birthYear: 1960, job: { salary: 100_000, lastYear: 2030 } },
  ],
  traditionalIra: 246_000,
  spending: 30_000,
  endYear: 2032,
};

function iraEnd2026(): number {
  const r = runOneYear(engineHousehold(household), 2026);
  const ira = r.individualAccountBalances.find((a) => a.taxType === "preTax");
  if (!ira) throw new Error("no Traditional IRA in 2026");
  return ira.balance;
}

describe("answer key: an RMD in a year a spouse still works", () => {
  xfail({
    id: "ret/RET05-1 [RET-05]",
    todo: 'v0.11 Retirement rules "RMDs skipped before the plan\'s withdrawal year" (decision D5)',
    run: iraEnd2026,
    expected: 236_000,
    today: 246_000,
    tolerance: 1,
  });
});
