import { describe, it, expect } from "vitest";
import {
  diffContribProfileSwap,
  type DiffAccount,
} from "@/lib/pure/contrib-profile-diff";

const account = (overrides: Partial<DiffAccount> = {}): DiffAccount => ({
  id: 1,
  accountName: "Sean 401k",
  live: { contributionValue: "0", contributionMethod: "percent_of_salary" },
  ...overrides,
});

describe("diffContribProfileSwap", () => {
  it("produces no lines when neither profile touches the account", () => {
    const lines = diffContribProfileSwap({}, {}, [account()]);
    expect(lines).toEqual([]);
  });

  it("produces no lines when both profiles set the same value", () => {
    const outgoing = { "1": { contributionValue: "14" } };
    const incoming = { "1": { contributionValue: "14" } };
    expect(diffContribProfileSwap(outgoing, incoming, [account()])).toEqual([]);
  });

  it("a displayNameActive-only difference produces no line (cosmetic)", () => {
    const outgoing = {
      "1": { contributionValue: "14", displayNameActive: "My 401k" },
    };
    const incoming = { "1": { contributionValue: "14" } };
    expect(diffContribProfileSwap(outgoing, incoming, [account()])).toEqual([]);
  });

  it("falls back to the live value when incoming doesn't touch the account", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
    };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({
        live: {
          contributionValue: "0",
          contributionMethod: "percent_of_salary",
        },
      }),
    ]);
    expect(lines).toEqual([
      "Sean 401k: 14% → using account's own value (currently 0%)",
    ]);
  });

  it("shows a direct value change when both profiles touch the account", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
    };
    const incoming = {
      "1": { contributionValue: "20", contributionMethod: "percent_of_salary" },
    };
    const lines = diffContribProfileSwap(outgoing, incoming, [account()]);
    expect(lines).toEqual(["Sean 401k: 14% → 20%"]);
  });

  it("isActive: false gets the 'excluded' phrasing, distinct from a rate change", () => {
    const outgoing = { "1": { isActive: false } };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({ live: { contributionValue: "10", isActive: true } }),
    ]);
    expect(lines).toEqual([
      "Sean 401k: excluded → using account's own value (currently 10)",
    ]);
  });

  it("multiple affected accounts produce multiple lines in stable order", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
      "2": { contributionValue: "500" },
    };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({
        id: 1,
        accountName: "Sean 401k",
        live: {
          contributionValue: "0",
          contributionMethod: "percent_of_salary",
        },
      }),
      account({
        id: 2,
        accountName: "Sean IRA",
        live: { contributionValue: "0" },
      }),
    ]);
    expect(lines).toEqual([
      "Sean 401k: 14% → using account's own value (currently 0%)",
      "Sean IRA: 500 → using account's own value (currently 0)",
    ]);
  });

  it("does not fire for an account neither profile's map even mentions", () => {
    const lines = diffContribProfileSwap(
      { "2": { contributionValue: "500" } },
      {},
      [account({ id: 1 })],
    );
    expect(lines).toEqual([]);
  });
});
