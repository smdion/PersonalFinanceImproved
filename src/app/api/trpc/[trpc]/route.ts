import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
// eslint-disable-next-line no-restricted-imports -- API route, server-side only
import { appRouter } from "@/server/routers";
// eslint-disable-next-line no-restricted-imports -- API route, server-side only
import { createContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
