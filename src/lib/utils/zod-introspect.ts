/**
 * Recursive Zod v4 `.def` walker → human-readable field descriptions.
 * Used by the API docs feature to introspect tRPC input schemas at runtime.
 */

export type SchemaField = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
};

/**
 * Walk a Zod v4 schema's `.def` tree and produce a flat list of field descriptions.
 * For object schemas, recurses into `.def.shape`. For non-objects, returns a single entry.
 */
export function introspectSchema(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const def = (schema as { def?: unknown }).def;
  if (!def || typeof def !== "object") return [];
  return walkDef(def as Record<string, unknown>, "", true);
}

function walkDef(
  def: Record<string, unknown>,
  name: string,
  required: boolean,
  defaultValue?: unknown,
): SchemaField[] {
  const type = def.type as string | undefined;
  if (!type) return [];

  switch (type) {
    case "object": {
      const shape = def.shape as
        | Record<string, { def?: Record<string, unknown> }>
        | undefined;
      if (!shape) return [];
      const fields: SchemaField[] = [];
      for (const [key, value] of Object.entries(shape)) {
        if (value && typeof value === "object" && value.def) {
          fields.push(
            ...walkDef(value.def as Record<string, unknown>, key, true),
          );
        }
      }
      return fields;
    }

    case "optional": {
      const inner = def.innerType as
        | { def?: Record<string, unknown> }
        | undefined;
      if (inner?.def) {
        return walkDef(
          inner.def as Record<string, unknown>,
          name,
          false,
          defaultValue,
        );
      }
      return [{ name, type: "unknown", required: false }];
    }

    case "default": {
      const inner = def.innerType as
        | { def?: Record<string, unknown> }
        | undefined;
      const defVal = def.defaultValue;
      if (inner?.def) {
        return walkDef(
          inner.def as Record<string, unknown>,
          name,
          false,
          defVal,
        );
      }
      return [{ name, type: "unknown", required: false, defaultValue: defVal }];
    }

    case "nullable": {
      const inner = def.innerType as
        | { def?: Record<string, unknown> }
        | undefined;
      if (inner?.def) {
        const resolved = walkDef(
          inner.def as Record<string, unknown>,
          name,
          required,
          defaultValue,
        );
        return resolved.map((f) => ({ ...f, type: `${f.type} | null` }));
      }
      return [
        {
          name,
          type: "unknown | null",
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    case "enum": {
      const entries = def.entries as Record<string, string> | undefined;
      const values = entries ? Object.values(entries) : [];
      const typeStr = values.map((v) => `'${v}'`).join(" | ");
      return [
        {
          name,
          type: typeStr || "enum",
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    case "literal": {
      const value = def.value;
      const typeStr = typeof value === "string" ? `'${value}'` : String(value);
      return [
        {
          name,
          type: typeStr,
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    case "union": {
      const options = def.options as
        | Array<{ def?: Record<string, unknown> }>
        | undefined;
      if (options) {
        const types = options
          .map((o) => {
            if (o?.def) {
              const resolved = walkDef(
                o.def as Record<string, unknown>,
                "",
                true,
              );
              return resolved.length === 1 ? resolved[0]!.type : "object";
            }
            return "unknown";
          })
          .join(" | ");
        return [
          {
            name,
            type: types,
            required,
            ...(defaultValue !== undefined && { defaultValue }),
          },
        ];
      }
      return [{ name, type: "union", required }];
    }

    case "array": {
      const element = def.element as
        | { def?: Record<string, unknown> }
        | undefined;
      let elementType = "unknown";
      if (element?.def) {
        const resolved = walkDef(
          element.def as Record<string, unknown>,
          "",
          true,
        );
        if (resolved.length === 1) elementType = resolved[0]!.type;
      }
      return [
        {
          name,
          type: `Array<${elementType}>`,
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    case "record": {
      const keySchema = def.keyType as
        | { def?: Record<string, unknown> }
        | undefined;
      const valueSchema = def.valueType as
        | { def?: Record<string, unknown> }
        | undefined;
      let keyType = "string";
      let valueType = "unknown";
      if (keySchema?.def) {
        const resolved = walkDef(
          keySchema.def as Record<string, unknown>,
          "",
          true,
        );
        if (resolved.length === 1) keyType = resolved[0]!.type;
      }
      if (valueSchema?.def) {
        const resolved = walkDef(
          valueSchema.def as Record<string, unknown>,
          "",
          true,
        );
        if (resolved.length === 1) valueType = resolved[0]!.type;
      }
      return [
        {
          name,
          type: `Record<${keyType}, ${valueType}>`,
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    case "string":
    case "number":
    case "boolean":
    case "date":
    case "bigint":
      return [
        {
          name,
          type,
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];

    case "int": {
      return [
        {
          name,
          type: "number (int)",
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
    }

    default:
      return [
        {
          name,
          type,
          required,
          ...(defaultValue !== undefined && { defaultValue }),
        },
      ];
  }
}
