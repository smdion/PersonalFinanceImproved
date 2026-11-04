/**
 * The `default` arm of an exhaustive switch over a closed set: it compiles
 * only when every member has its own case, and throws if a value outside
 * the set arrives at run time.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
