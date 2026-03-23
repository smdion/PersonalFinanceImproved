import type { SchemaField } from "@/lib/utils/zod-introspect";

export type AuthLevel = "public" | "protected" | "admin" | string;

export type ApiEndpoint = {
  path: string;
  type: "query" | "mutation";
  auth: AuthLevel;
  input: SchemaField[];
  router: string;
};
