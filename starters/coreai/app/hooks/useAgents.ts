// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Agent, AgentStatus } from '~/data';

import { useQuery } from '@tanstack/react-query';

import { agents, filterAgentsByStatus } from '~/data';

/**
 * Simulates async delay for realistic loading states.
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for filtering agents.
 */
export interface UseAgentsOptions {
  /** Filter agents by status */
  status?: AgentStatus;
}

/**
 * Hook to fetch agents data with optional filtering.
 * Returns TanStack Query result with loading states, errors, and data.
 *
 * @param options - Optional filters to apply to agents
 * @example
 * ```tsx
 * // Get all agents
 * const { data, isLoading } = useAgents();
 *
 * // Get only draft agents
 * const { data, isLoading } = useAgents({ status: 'draft' });
 * ```
 */
export function useAgents(options?: UseAgentsOptions) {
  return useQuery({
    queryKey: ['agents', options?.status],
    queryFn: async (): Promise<Agent[]> => {
      // Simulate network delay
      await delay(400);

      // Return filtered or all agents
      if (options?.status) {
        return filterAgentsByStatus(agents, options.status);
      }

      return agents;
    },
  });
}
