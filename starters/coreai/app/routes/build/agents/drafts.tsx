import type { JSX } from 'react';

import { AgentList } from './AgentList';

export default function DraftAgents(): JSX.Element {
  return (
    <AgentList
      emptyStateDescription="Create a new agent to get started"
      emptyStateTitle="No draft agents"
      searchLabel="Search drafts"
      status="draft"
    />
  );
}
