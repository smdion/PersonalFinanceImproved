/**
 * friendlyMutationError — the global mutation-error toast copy mapper.
 */
import { describe, it, expect } from "vitest";
import { friendlyMutationError } from "@/lib/utils/mutation-error";

describe("friendlyMutationError", () => {
  it("passes a hand-written BAD_REQUEST message straight through", () => {
    expect(
      friendlyMutationError({
        message: "One of the pasted amounts isn't a valid number.",
        data: { code: "BAD_REQUEST" },
      }),
    ).toBe("One of the pasted amounts isn't a valid number.");
  });

  it("maps FORBIDDEN / NOT_FOUND / CONFLICT to friendly copy, ignoring the raw message", () => {
    expect(
      friendlyMutationError({
        message: 'permission "budget" required',
        data: { code: "FORBIDDEN" },
      }),
    ).toBe("You don't have permission to do that.");
    expect(
      friendlyMutationError({
        message: "row not found",
        data: { code: "NOT_FOUND" },
      }),
    ).toMatch(/couldn't be found/);
    expect(friendlyMutationError({ data: { code: "CONFLICT" } })).toMatch(
      /conflicts with the current data/,
    );
  });

  it("never surfaces an INTERNAL_SERVER_ERROR message", () => {
    const out = friendlyMutationError({
      message:
        'duplicate key value violates unique constraint "budget_items_pkey"',
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(out).not.toMatch(/constraint|duplicate key/);
    expect(out).toMatch(/on our end/);
  });

  it("surfaces the first field issue from a Zod input error, not the JSON dump", () => {
    const out = friendlyMutationError({
      message:
        '[{"code":"too_small","path":["amount"],"message":"Number must be positive"}]',
      data: {
        code: "BAD_REQUEST",
        zodError: {
          formErrors: [],
          fieldErrors: { amount: ["Number must be positive"] },
        },
      },
    });
    expect(out).toBe("Invalid input: Number must be positive");
  });

  it("handles a bare network error (no data.code) with a connectivity message", () => {
    expect(friendlyMutationError({ message: "Failed to fetch" })).toMatch(
      /reach the server/,
    );
  });

  it("falls back to a generic line for anything unrecognized", () => {
    expect(friendlyMutationError({})).toBe(
      "Something went wrong. Please try again.",
    );
    expect(friendlyMutationError(null)).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
