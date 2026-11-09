/**
 * The "Changes by year" editor saves only the account caps a household
 * filled in: a blank account is uncapped, never a $0 cap (owner K1b).
 */
import { describe, expect, it } from "vitest";
import { enteredCaps } from "@/components/retirement-projection/entered-caps";
import { buildCategoryRecord } from "@/lib/config/account-types";

const blank = () => buildCategoryRecord(() => "");

describe("enteredCaps", () => {
  it("keeps only the caps entered", () => {
    expect(enteredCaps({ ...blank(), ira: "3000" })).toEqual({ ira: 3000 });
  });

  it("keeps an entered 0 (a cap of $0 the household chose)", () => {
    expect(enteredCaps({ ...blank(), hsa: "0" })).toEqual({ hsa: 0 });
  });

  it("is undefined when no cap is entered", () => {
    expect(enteredCaps(blank())).toBeUndefined();
  });
});
