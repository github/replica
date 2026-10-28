import type { Tool } from '~/data';
import type { TableColumnDefinition } from '~/components/common';

import { Badge, Button, Text, Divider } from '@coreai-ds/react-components';
import { CollectionDetailsPage, DetailsList } from '~/components/common';

import { useTools } from '~/hooks/useTools';

import styles from './tools.module.css';

export default function BuildTools() {
  const { data: tools, isLoading } = useTools();

  const handleConnectTool = () => {
    // TODO: Implement connect tool functionality
    console.log('Connect a tool clicked');
  };

  const columns: TableColumnDefinition<Tool>[] = [
    {
      columnId: 'name',
      renderHeaderCell: () => 'Name',
      renderCell: (tool) => tool.name,
      compare: (a, b) => a.name.localeCompare(b.name),
      onSearch: (term, tool) => tool.name.toLowerCase().includes(term.toLowerCase()),
    },
    {
      columnId: 'description',
      renderHeaderCell: () => 'Description',
      renderCell: (tool) => tool.description,
      onSearch: (term, tool) => tool.description.toLowerCase().includes(term.toLowerCase()),
      compare: () => 0,
    },
    {
      columnId: 'category',
      renderHeaderCell: () => 'Category',
      renderCell: (tool) => tool.category,
      compare: (a, b) => a.category.localeCompare(b.category),
      filterOptions: {
        showFilter: true,
        label: 'Category',
      },
    },
    {
      columnId: 'isPublished',
      renderHeaderCell: () => 'Status',
      renderCell: (tool) => (
        <Badge appearance="outline" color={tool.isPublished ? 'success' : 'severe'} shape="rounded">
          {tool.isPublished ? 'Published' : 'Draft'}
        </Badge>
      ),
      interactiveChildren: 'none',
      compare: (a, b) => Number(a.isPublished) - Number(b.isPublished),
      filterOptions: {
        showFilter: true,
        label: 'Status',
        options: [
          { children: 'Published', value: 'true' },
          { children: 'Draft', value: 'false' },
        ],
        onFilter: (tool, option) => String(tool.isPublished) === option,
      },
    },
  ];

  return (
    <CollectionDetailsPage
      headerProps={{
        title: 'Tools',
        headerActions: (
          <Button appearance="primary" onClick={handleConnectTool}>
            Connect a tool
          </Button>
        ),
      }}
      dataGridProps={{
        columns,
        emptyState: {
          title: 'No tools available',
          description: 'Create a new tool to get started',
        },
        enableSearch: true,
        getRowId: (tool) => tool.id,
        isLoading,
        items: tools ?? [],
        searchLabel: 'Search tools',
      }}
      renderDetails={(itemId) => {
        const tool = tools?.find((t) => t.id === itemId);
        if (!tool) return undefined;

        return {
          title: tool.name,
          content: (
            <div className={styles.detailsContent}>
              <div className={styles.detailsSection}>
                <Text foreground={1} preset="bodyStrong" block>
                  Description
                </Text>
                <Text foreground={2} preset="body" block>
                  {tool.description}
                </Text>
              </div>
              <Divider />
              <DetailsList
                items={[
                  { label: 'Category', value: tool.category },
                  {
                    label: 'Status',
                    value: (
                      <Badge
                        appearance={tool.isPublished ? 'tint' : 'outline'}
                        color={tool.isPublished ? 'success' : 'severe'}
                        shape="rounded"
                      >
                        {tool.isPublished ? 'Published' : 'Draft'}
                      </Badge>
                    ),
                  },
                  { label: 'Tool ID', value: tool.id },
                ]}
              />
            </div>
          ),
        };
      }}
    />
  );
}
