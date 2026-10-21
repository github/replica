// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Agent } from '~/data';
import type { TableColumnDefinition } from '~/components/common';

import { Badge } from '@coreai-ds/react-components';
import { CollectionPage } from '~/components/common';

import { useAgents } from '~/hooks/useAgents';

import styles from './agents.module.css';

export default function OperateAgents() {
  const { data: agents, isLoading } = useAgents({ status: 'deployed' });

  const columns: TableColumnDefinition<Agent>[] = [
    {
      columnId: 'name',
      renderHeaderCell: () => 'Name',
      renderCell: (agent) => agent.name,
      compare: (a, b) => a.name.localeCompare(b.name),
      onSearch: (term, agent) => agent.name.toLowerCase().includes(term.toLowerCase()),
    },
    {
      columnId: 'description',
      renderHeaderCell: () => 'Description',
      renderCell: (agent) => agent.description,
      onSearch: (term, agent) => agent.description.toLowerCase().includes(term.toLowerCase()),
      compare: () => 0,
    },
    {
      columnId: 'tags',
      renderHeaderCell: () => 'Tags',
      renderCell: (agent) => (
        <div className={styles.tagsCell}>
          {agent.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} appearance="outline" shape="rounded" size="small">
              {tag}
            </Badge>
          ))}
        </div>
      ),
      compare: () => 0,

      interactiveChildren: 'none',
    },
    {
      columnId: 'owner',
      renderHeaderCell: () => 'Owner',
      renderCell: (agent) => agent.owner,
      compare: (a, b) => a.owner.localeCompare(b.owner),
      onSearch: (term, agent) => agent.owner.toLowerCase().includes(term.toLowerCase()),
      filterOptions: {
        showFilter: true,
        label: 'Owner',
      },
    },
    {
      columnId: 'version',
      renderHeaderCell: () => 'Version',
      renderCell: (agent) => agent.version,
      compare: (a, b) => a.version.localeCompare(b.version),
    },
    {
      columnId: 'updatedDate',
      renderHeaderCell: () => 'Last Updated',
      renderCell: (agent) =>
        new Date(agent.updatedDate).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      compare: (a, b) => new Date(a.updatedDate).getTime() - new Date(b.updatedDate).getTime(),
    },
  ];

  return (
    <CollectionPage
      headerProps={{ title: 'Agents' }}
      dataGridProps={{
        columns,
        emptyState: {
          title: 'No deployed agents',
          description: 'Deploy an agent to start monitoring its performance',
        },
        enableSearch: true,
        getRowId: (agent) => agent.id,
        isLoading,
        items: agents ?? [],
        searchLabel: 'Search agents',
      }}
    />
  );
}
