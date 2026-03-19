"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  type DehydratedState,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastContainer } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/hooks/use-toast";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  dehydratedState?: DehydratedState;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
        mutationCache: new MutationCache({
          onError: (error) => {
            toast.error(error.message || "Something went wrong");
          },
        }),
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <TooltipProvider delayDuration={200} skipDelayDuration={100}>
            {children}
            <ToastContainer />
            <ConfirmDialog />
          </TooltipProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
