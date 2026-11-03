/** The message of a request refused because its demo profile is missing or
 *  out of date (`data.demoSessionEnded`, set by trpc.ts's error formatter);
 *  null for any other error. */
export function demoSessionEndedMessage(error: unknown): string | null {
  const e = (error ?? {}) as {
    message?: unknown;
    data?: { demoSessionEnded?: unknown } | null;
  };
  if (e.data?.demoSessionEnded !== true) return null;
  return typeof e.message === "string" && e.message
    ? e.message
    : "This demo session has ended. Choose a demo profile again.";
}
