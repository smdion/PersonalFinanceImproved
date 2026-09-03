/**
 * friendlyMutationError — turns a failed-mutation error into a single
 * user-facing sentence for the global toast (src/app/providers.tsx's
 * MutationCache.onError), or `null` to suppress the toast entirely.
 *
 * The raw `error.message` on a tRPC client error is only safe to show for
 * a hand-written `BAD_REQUEST` (procedures are expected to phrase those for
 * users). Everything else — Zod input-validation dumps, DB constraint
 * strings, `INTERNAL_SERVER_ERROR` internals — gets mapped to friendly copy
 * by its `data.code`. Zod failures arrive as a structured
 * `data.zodError` because trpc.ts's errorFormatter flattens them.
 */

type ZodFlattened = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

type TrpcClientErrorShape = {
  message?: string;
  data?: {
    code?: string;
    zodError?: ZodFlattened | null;
  } | null;
};

const CODE_COPY: Record<string, string> = {
  UNAUTHORIZED: "Please sign in and try again.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That item couldn't be found — it may have been deleted.",
  CONFLICT:
    "That change conflicts with the current data — reload and try again.",
  TIMEOUT: "The request timed out. Please try again.",
  TOO_MANY_REQUESTS: "Too many requests — wait a moment and try again.",
  PAYLOAD_TOO_LARGE: "That request was too large to process.",
  UNPROCESSABLE_CONTENT: "Please check the values you entered.",
  METHOD_NOT_SUPPORTED: "Something went wrong. Please try again.",
  INTERNAL_SERVER_ERROR: "Something went wrong on our end. Please try again.",
};

const GENERIC = "Something went wrong. Please try again.";

/**
 * @returns the toast copy, or `null` when the failure shouldn't be toasted
 *   at all (a deliberately-aborted request).
 */
export function friendlyMutationError(error: unknown): string | null {
  const e = (error ?? {}) as TrpcClientErrorShape;
  const code = e.data?.code;

  // Aborted by the user / by TanStack on unmount — not an error to report.
  if (code === "CLIENT_CLOSED_REQUEST") return null;

  // Zod input-validation failure — surface the first concrete field issue,
  // never the stringified-JSON `message`.
  const zod = e.data?.zodError;
  if (zod) {
    const first =
      Object.values(zod.fieldErrors ?? {})
        .flat()
        .find((m): m is string => !!m) ?? (zod.formErrors ?? []).find(Boolean);
    return first
      ? `Invalid input: ${first}`
      : "Please check the values you entered.";
  }

  if (code && code in CODE_COPY) return CODE_COPY[code]!;

  // Hand-written BAD_REQUEST: the procedure phrased it for the user.
  if (code === "BAD_REQUEST" && e.message) return e.message;

  // No `data.code` at all → the response never reached tRPC's formatter
  // (network drop, aborted fetch, a proxy error page). Don't diagnose the
  // cause — a server outage lands here too.
  if (code === undefined && e.message) {
    return "Couldn't reach the server. Please try again.";
  }

  return GENERIC;
}
