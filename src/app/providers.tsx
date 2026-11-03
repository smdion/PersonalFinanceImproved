"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastContainer } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/hooks/use-toast";
import { friendlyMutationError } from "@/lib/utils/mutation-error";
import { demoSessionEndedMessage } from "@/lib/utils/demo-session";
import { DemoSessionEndedNotice } from "@/components/layout/demo-session-ended";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // A refused demo profile refuses every call: the page gives way to the
  // way back to the demo picker.
  const [demoEnded, setDemoEnded] = useState<string | null>(null);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              !demoSessionEndedMessage(error) && failureCount < 3,
          },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            const ended = demoSessionEndedMessage(error);
            if (ended) setDemoEnded(ended);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            const ended = demoSessionEndedMessage(error);
            if (ended) return setDemoEnded(ended);
            // Keep the raw error in the console for field diagnosis; the
            // toast gets the friendly version (or nothing, for aborts).
            console.warn("mutation failed", error);
            const msg = friendlyMutationError(error);
            if (msg) toast.error(msg);
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
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          {demoEnded ? (
            <DemoSessionEndedNotice message={demoEnded} />
          ) : (
            children
          )}
          <ToastContainer />
          <ConfirmDialog />
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
