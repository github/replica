import type { Agent } from '~/data';
import type { TableColumnDefinition } from '~/components/common';
import type { JSX } from 'react';

import { Badge } from '@coreai-ds/react-components';
import { GridContent, Link } from '~/components/common';

import { useAgents } from '~/hooks/useAgents';

import styles from '../agents.module.css';

interface AgentListProps {
  emptyStateDescription: string;
  emptyStateTitle: string;
  searchLabel: string;
  status?: Agent['status'];
}

export function AgentList({
  emptyStateDescription,
  emptyStateTitle,
  searchLabel,
  status,
}: AgentListProps): JSX.Element {
  const { data: agents, isLoading } = useAgents();

  const columns: TableColumnDefinition<Agent>[] = [
    {
      columnId: 'name',
      renderHeaderCell: () => 'Name',
      renderCell: (agent) => <Link to={`/build/agents/${agent.id}`}>{agent.name}</Link>,
      interactiveChildren: 'single',
      compare: (a, b) => a.name.localeCompare(b.name),
      onSearch: (term, agent) => agent.name.toLowerCase().includes(term.toLowerCase()),
    },
    {
      columnId: 'description',
      renderHeaderCell: () => 'Description',
      renderCell: (agent) => agent.description,
      onSearch: (term, agent) => agent.description.toLowerCase().includes(term.toLowerCase()),
      compare: (a, b) => a.description.localeCompare(b.description),
    },
    {
      columnId: 'status',
      renderHeaderCell: () => 'Status',
      renderCell: (agent) => agent.status,
      compare: (a, b) => a.status.localeCompare(b.status),
      filterOptions: {
        showFilter: true,
        label: 'Status',
        options: ['draft', 'published', 'deployed'],
      },
    },
    {
      columnId: 'tags',
      renderHeaderCell: () => 'Tags',
      renderCell: (agent) => (
        <div className={styles.tagsCell}>
          {agent.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} appearance="outline" color="informative" shape="rounded" size="small">
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

  const items =
    status === undefined
      ? (agents ?? [])
      : (agents ?? []).filter((agent) => agent.status === status);

  return (
    <GridContent
      dataGridProps={{
        columns,
        emptyState: {
          title: emptyStateTitle,
          description: emptyStateDescription,
        },
        enableSearch: true,
        getRowId: (agent) => agent.id,
        isLoading,
        items,
        searchLabel,
      }}
    />
  );
}
