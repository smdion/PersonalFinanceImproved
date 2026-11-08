"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * Derived tRPC I/O types — use these instead of hand-copying a procedure's
 * shape into a client module with a "keep in sync" comment. `AppRouter` is
 * already a type-only import here, so this crosses no new boundary.
 *   type Foo = RouterOutputs["budget"]["updateItemAmounts"];
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
/** A failed query's error, for a hook that reports one of several. */
export type RouterError = TRPCClientErrorLike<AppRouter>;
