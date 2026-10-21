// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useMemo } from 'react';
import { Text } from '@coreai-ds/react-components';

import { CatalogView } from './catalog/CatalogView';
import type { ICatalogItem, ISortOption } from './catalog/Catalog.types';
import { tools } from '~/data';

import styles from './tools.module.css';

const sortOptions: ISortOption[] = [
  {
    key: 'name-asc',
    text: 'Name A-Z',
    onSort: (items) => items.sort((first, second) => first.name.localeCompare(second.name)),
  },
  {
    key: 'name-desc',
    text: 'Name Z-A',
    onSort: (items) => items.sort((first, second) => second.name.localeCompare(first.name)),
  },
];

export default function DiscoverTools() {
  // Transform tools into catalog items
  const catalogItems: ICatalogItem[] = useMemo(
    () =>
      tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        icon: (
          <Text
            aria-hidden="true"
            className={styles.toolMark}
            preset="body"
            // eslint-disable-next-line no-restricted-syntax -- color comes from tool data
            style={{ color: tool.initialsColor }}
          >
            {tool.mark}
          </Text>
        ),
        category: tool.category,
        filterProperties: {
          category: tool.category,
          status: tool.isPublished ? 'Published' : 'Draft',
        },
      })),
    [],
  );

  return (
    <CatalogView
      title="Tools"
      description="Discover and explore tools available for agents"
      getItemHref={(item) => `/discover/tools/${item.id}`}
      items={catalogItems}
      isLoading={false}
      sortOptions={sortOptions}
      defaultSortKey="name-asc"
    />
  );
}
