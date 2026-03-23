/** Introspection router that walks the app router tree to produce a list of all API endpoints for the docs UI. */
import { createTRPCRouter, adminProcedure } from "../trpc";
import { walkRouter, type ApiEndpoint } from "../api-docs";

export const apiDocsRouter = createTRPCRouter({
  list: adminProcedure.query(async (): Promise<ApiEndpoint[]> => {
    // Lazy import breaks the circular dependency:
    // api-docs router → index → api-docs router
    const { appRouter } = await import("./index");
    return walkRouter(appRouter._def.record as Record<string, unknown>);
  }),
});
