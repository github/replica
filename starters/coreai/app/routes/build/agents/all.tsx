import type { JSX } from 'react';

import { AgentList } from './AgentList';

export default function AllAgents(): JSX.Element {
  return (
    <AgentList
      emptyStateDescription="Create a new agent to get started"
      emptyStateTitle="No agents"
      searchLabel="Search agents"
    />
  );
}
