/**
 * A request refused for its demo profile carries `data.demoSessionEnded`
 * (src/server/trpc.ts's error formatter), and the client's reader of it.
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/routers";
import { DemoSessionEnded } from "@/lib/demo/session-ended";
import { demoSessionEndedMessage } from "@/lib/utils/demo-session";

function format(error: TRPCError) {
  return appRouter._def._config.errorFormatter({
    shape: {
      message: error.message,
      code: -32012,
      data: { code: error.code, httpStatus: 412 },
    },
    error,
    type: "query",
    path: "x",
    input: undefined,
    ctx: undefined,
  });
}

describe("a refused demo profile", () => {
  it("is marked for the client, which reads its message", () => {
    const shape = format(
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Choose a demo profile again.",
        cause: new DemoSessionEnded("Choose a demo profile again."),
      }),
    );
    expect(shape.data).toMatchObject({ demoSessionEnded: true });
    expect(demoSessionEndedMessage(shape)).toBe("Choose a demo profile again.");
  });

  it("any other precondition failure isn't", () => {
    const shape = format(
      new TRPCError({ code: "PRECONDITION_FAILED", message: "Link YNAB." }),
    );
    expect(shape.data).toMatchObject({ demoSessionEnded: false });
    expect(demoSessionEndedMessage(shape)).toBeNull();
    expect(demoSessionEndedMessage(undefined)).toBeNull();
  });

  it("with no message from the server, says so plainly", () => {
    expect(demoSessionEndedMessage({ data: { demoSessionEnded: true } })).toBe(
      "This demo session has ended. Choose a demo profile again.",
    );
  });
});
