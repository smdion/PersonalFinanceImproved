/**
 * Credentials never land in the change log. A mutation's raw input is
 * logged for the audit trail (`logMutation`, server/trpc.ts); a value under
 * one of these keys — at any depth — is replaced first. The same list
 * drives the migration that scrubbed rows logged before (drizzle 0007), so
 * add a key here and there together.
 */
export const SECRET_INPUT_KEYS: readonly string[] = [
  "accessToken", // YNAB
  "apiKey", // Actual, Tiingo
  "setupToken", // SimpleFIN (single-use, still a credential)
  "accessUrl", // SimpleFIN's claimed URL carries its credentials
  "token",
  "password",
  "passwordHash",
  "secret",
  "clientSecret",
  "config", // api_connections config — every service's credentials
];

const SECRET_KEYS = new Set(SECRET_INPUT_KEYS);
export const REDACTED = "[redacted]";

/** `value` with every secret key's value replaced, at any depth. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEYS.has(k) ? REDACTED : redactSecrets(v),
    ]),
  );
}
