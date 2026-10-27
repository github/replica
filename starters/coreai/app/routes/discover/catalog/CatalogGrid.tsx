// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ICatalogItem } from './Catalog.types';
import type { JSX } from 'react';

import { clsx } from 'clsx';
import { isValidElement } from 'react';

import { CardHeader, CardPreview, Spinner, Text } from '@coreai-ds/react-components';
import { Card } from '~/components/common';

import styles from './CatalogGrid.module.css';

export interface ICatalogGridProps {
  /**
   * Type of items in the catalog (e.g., "models", "tools", "agents")
   * Used for accessibility labels to provide context for screen readers
   */
  catalogType?: string;

  /**
   * CSS class name for the component
   */
  className?: string;

  /**
   * Array of items to display in the grid
   */
  items: ICatalogItem[];

  /**
   * Returns the detail-page URL for an item
   */
  getItemHref: (item: ICatalogItem) => string;

  /**
   * Whether the catalog is currently loading data
   */
  isLoading: boolean;

  /**
   * Custom render function for each item
   * If not provided, items will be rendered as linked cards
   */
  renderItem?: (item: ICatalogItem) => JSX.Element;
}

export function CatalogGrid({
  catalogType,
  className,
  getItemHref,
  items,
  isLoading,
  renderItem,
}: ICatalogGridProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={clsx(styles.loadingContainer, className)}>
        <Spinner label="Loading" size="medium" />
      </div>
    );
  }

  if (renderItem) {
    return (
      <div className={clsx(styles.container, className)}>
        <div
          aria-label={`${catalogType ?? 'items'} catalog`}
          className={styles.customGrid}
          role="list"
        >
          {items.map((item) => (
            <div key={item.id} role="listitem">
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.container, className)}>
      <div
        aria-label={`${catalogType ?? ''} catalog`}
        className={clsx(styles.cardGroup, className)}
        role="list"
      >
        {items.map((item) => {
          return (
            <div key={item.id} role="listitem">
              <Card
                aria-label={`${item.name}${item.description ? `: ${item.description}` : ''}`}
                className={styles.card}
                disabled={item.disabled}
                appearance="filled"
                orientation="horizontal"
                to={getItemHref(item)}
                type="link"
              >
                {isValidElement(item.icon) ? (
                  <CardPreview className={styles.cardIcon}>{item.icon}</CardPreview>
                ) : null}
                <CardHeader
                  className={styles.cardHeader}
                  description={
                    <Text foreground={2} className={styles.cardDescription} preset="bodyS">
                      {item.description}
                    </Text>
                  }
                  header={
                    <Text foreground={1} as="h2" preset="bodyStrong">
                      {item.name}
                    </Text>
                  }
                />
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
