import { environmentManager, QueryClient } from "@tanstack/react-query";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60 * 1000 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** Creates an isolated server query cache or reuses the browser cache across Suspense retries. */
export function getQueryClient() {
  if (environmentManager.isServer()) {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}
