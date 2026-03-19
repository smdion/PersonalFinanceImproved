/**
 * Router tree walker — traverses `appRouter._def.record` at runtime
 * to produce a flat list of all tRPC endpoints with metadata.
 *
 * tRPC v11 structure:
 * - `appRouter._def.record` has keys that are either:
 *   - A procedure (has `._def.procedure === true`)
 *   - A namespace (plain object whose values are procedures or more namespaces — no _def)
 */

import { introspectSchema, type SchemaField } from "@/lib/utils/zod-introspect";

export type AuthLevel = "public" | "protected" | "admin" | string;

export type ApiEndpoint = {
  path: string;
  type: "query" | "mutation";
  auth: AuthLevel;
  input: SchemaField[];
  router: string;
};

export function walkRouter(
  record: Record<string, unknown>,
  prefix = "",
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (!value || (typeof value !== "object" && typeof value !== "function"))
      continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;
    const topRouter = prefix ? prefix.split(".")[0]! : key;

    const def = (value as Record<string, unknown>)._def as
      | Record<string, unknown>
      | undefined;

    if (def?.procedure) {
      // It's a procedure — extract metadata
      const procType = (def.type as string) || "query";
      const meta = (def.meta as { auth?: AuthLevel } | undefined) ?? {};
      const auth = meta.auth ?? "unknown";

      const inputs = def.inputs as unknown[] | undefined;
      let input: SchemaField[] = [];
      if (inputs && inputs.length > 0) {
        input = introspectSchema(inputs[0]);
      }

      endpoints.push({
        path: fullPath,
        type: procType as "query" | "mutation",
        auth,
        input,
        router: topRouter,
      });
    } else {
      // It's a namespace (plain object) — recurse into its entries
      endpoints.push(...walkRouter(value as Record<string, unknown>, fullPath));
    }
  }

  return endpoints.sort((a, b) => a.path.localeCompare(b.path));
}
