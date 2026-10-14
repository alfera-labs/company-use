import * as Sentry from '@sentry/tanstackstart-react';
import {
  isServer,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // react-query stores a failed fetch in its own error state instead of throwing it,
        // so it never reaches a window error handler or error.tsx. This is the only hook
        // that sees it.
        queryCache: new QueryCache({ onError: (error) => Sentry.captureException(error) }),
        mutationCache: new MutationCache({ onError: (error) => Sentry.captureException(error) }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: isServer ? Number.POSITIVE_INFINITY : 30 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
