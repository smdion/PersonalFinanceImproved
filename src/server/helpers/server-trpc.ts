/**
 * Server-side tRPC caller for prefetching data in Server Components.
 *
 * Usage in a server component (layout or page wrapper):
 *
 *   import { createServerHelpers } from '@/server/helpers/server-trpc';
 *
 *   export default async function Page() {
 *     const helpers = await createServerHelpers();
 *     await helpers.networth.getSummary.prefetch();
 *     return (
 *       <HydrationProvider dehydratedState={helpers.dehydrate()}>
 *         <ClientPage />
 *       </HydrationProvider>
 *     );
 *   }
 */
import { createServerSideHelpers } from "@trpc/react-query/server";
import { createContext } from "../trpc";
import { appRouter } from "../routers";

export async function createServerHelpers() {
  const ctx = await createContext();
  return createServerSideHelpers({
    router: appRouter,
    ctx,
  });
}
