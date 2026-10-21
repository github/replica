// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Tool, ToolCategory } from '~/data';

import { useQuery } from '@tanstack/react-query';

import { filterToolsByCategory, filterToolsByPublished, tools } from '~/data';

/**
 * Simulates async delay for realistic loading states.
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for filtering tools.
 */
export interface UseToolsOptions {
  /** Filter tools by category */
  category?: ToolCategory;
  /** Filter tools by published status */
  isPublished?: boolean;
}

/**
 * Hook to fetch tools data with optional filtering.
 * Returns TanStack Query result with loading states, errors, and data.
 *
 * @param options - Optional filters to apply to tools
 * @example
 * ```tsx
 * // Get all tools
 * const { data, isLoading } = useTools();
 *
 * // Get only published tools
 * const { data, isLoading } = useTools({ isPublished: true });
 *
 * // Get tools by category
 * const { data, isLoading } = useTools({ category: 'Data' });
 * ```
 */
export function useTools(options?: UseToolsOptions) {
  return useQuery({
    queryKey: ['tools', options?.category, options?.isPublished],
    queryFn: async (): Promise<Tool[]> => {
      // Simulate network delay
      await delay(400);

      let result = tools;

      // Apply category filter if provided
      if (options?.category) {
        result = filterToolsByCategory(result, options.category);
      }

      // Apply published filter if provided
      if (options?.isPublished !== undefined) {
        result = filterToolsByPublished(result, options.isPublished);
      }

      return result;
    },
  });
}
