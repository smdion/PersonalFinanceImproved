import { TRPCError } from "@trpc/server";

/** The cause of a request refused for its demo profile (none chosen, missing,
 *  or built before the latest migration): the client shows the way back to
 *  the demo picker instead of retrying. */
export class DemoSessionEnded extends Error {}

/** The refusal itself, with its message as the client shows it. */
export function demoSessionEnded(message: string): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message,
    cause: new DemoSessionEnded(message),
  });
}
