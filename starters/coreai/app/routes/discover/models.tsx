// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useMemo } from 'react';
import { Text } from '@coreai-ds/react-components';

import { CatalogView } from './catalog/CatalogView';
import type { ICatalogItem } from './catalog/Catalog.types';
import { models } from '~/data';

import styles from './tools.module.css';

export default function DiscoverModels() {
  // Transform models into catalog items
  const catalogItems: ICatalogItem[] = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        icon: (
          <Text
            aria-hidden="true"
            className={styles.toolMark}
            preset="body"
            // eslint-disable-next-line no-restricted-syntax -- color comes from model data
            style={{ color: model.initialsColor }}
          >
            {model.mark}
          </Text>
        ),
        provider: model.provider,
        category: model.category,
        version: model.version,
        releaseDate: model.releaseDate,
        filterProperties: {
          provider: model.provider,
          category: model.category,
          status: model.isPublished ? 'Published' : 'Draft',
        },
      })),
    [],
  );

  return (
    <CatalogView
      title="Models"
      description="Discover and explore AI models available in the platform"
      getItemHref={(item) => `/discover/models/${item.id}`}
      items={catalogItems}
      isLoading={false}
    />
  );
}
