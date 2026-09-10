"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getQueryClient } from "@/lib/query-client";

/** Provides the query cache to client components without making the root layout a Client Component. */
export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
