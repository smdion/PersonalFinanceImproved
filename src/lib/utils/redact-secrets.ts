/**
 * Keys whose values (at any depth) are redacted before a mutation's input is
 * logged (`logMutation`). Drizzle migration 0007 scrubs with the same list, so
 * change both together.
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
