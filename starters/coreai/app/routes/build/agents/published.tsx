import type { JSX } from 'react';

import { AgentList } from './AgentList';

export default function PublishedAgents(): JSX.Element {
  return (
    <AgentList
      emptyStateDescription="Publish an agent to see it here"
      emptyStateTitle="No published agents"
      searchLabel="Search published"
      status="published"
    />
  );
}
