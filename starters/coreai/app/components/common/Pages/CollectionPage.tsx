// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { GridContentProps } from './GridContent';
import type { PageHeaderProps } from './PageHeader';

import { GridContent } from './GridContent';
import { PageLayout } from './PageLayout';
import { PageHeader } from './PageHeader';

/** Standalone collection header and grid configuration. */
export interface CollectionPageProps<T> extends GridContentProps<T> {
  headerProps: PageHeaderProps;
}

/** Composes a fixed page header with a padded, independently scrolling grid. */
export function CollectionPage<T>({ headerProps, dataGridProps }: CollectionPageProps<T>) {
  return (
    <PageLayout header={<PageHeader {...headerProps} />} scrollMode="panes">
      <GridContent dataGridProps={dataGridProps} />
    </PageLayout>
  );
}
