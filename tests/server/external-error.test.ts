/**
 * The tRPC error formatter's `externalError` and `userMessage`
 * (src/server/trpc.ts), as the client's toast receives them.
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/routers";
import {
  BudgetApiError,
  WriteStopped,
  nothingChanged,
} from "@/lib/budget-api/errors";

function format(cause: unknown) {
  return appRouter._def._config.errorFormatter({
    shape: {
      message: "",
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    },
    error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
    type: "mutation",
    path: "x",
    input: undefined,
    ctx: undefined,
  }).data as { externalError: unknown; userMessage: string | null };
}

function failure(code: ConstructorParameters<typeof BudgetApiError>[1]) {
  const e = new BudgetApiError("raw", code, null);
  e.service = "YNAB";
  return e;
}

describe("the error formatter", () => {
  it("a service failure alone claims nothing about what changed", () => {
    expect(format(failure("timeout"))).toMatchObject({
      externalError: { service: "YNAB", code: "timeout", field: null },
      userMessage: "Ledgr couldn't reach YNAB — try again.",
    });
  });

  it("a site that wrote nothing yet says so", () => {
    expect(format(nothingChanged(failure("timeout"))).userMessage).toBe(
      "Ledgr couldn't reach YNAB — try again. Nothing was changed.",
    );
  });

  it("a write stopped partway says what landed", () => {
    const stopped = new WriteStopped(
      "Pushed 1 of 2",
      "Pushed 1 of 2 budget targets before it stopped.",
      failure("auth"),
    );
    expect(format(stopped).userMessage).toBe(
      "YNAB didn't accept Ledgr's credentials — reconnect it in Settings. Pushed 1 of 2 budget targets before it stopped.",
    );
  });

  it("a write stopped partway by something else still says what landed", () => {
    const stopped = new WriteStopped("x", "Deleted 2 old adjustments.");
    expect(format(stopped)).toMatchObject({
      externalError: null,
      userMessage: "Something went wrong. Deleted 2 old adjustments.",
    });
  });

  it("an error with no service behind it gets neither", () => {
    expect(format(new Error("db down"))).toMatchObject({
      externalError: null,
      userMessage: null,
    });
  });
});
