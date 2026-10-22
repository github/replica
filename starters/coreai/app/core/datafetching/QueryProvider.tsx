// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export interface QueryProviderProps {
  children: ReactNode;
}

/**
 * Provides TanStack Query context to the application.
 * Creates a QueryClient instance with sensible defaults for a demo app.
 */
export function QueryProvider({ children }: QueryProviderProps): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes - data is considered fresh
            gcTime: 10 * 60 * 1000, // 10 minutes - garbage collection time (formerly cacheTime)
            retry: false, // Don't retry failed requests in demo app
            refetchOnWindowFocus: false, // Don't refetch when window regains focus
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
