// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { GridDetailsContentProps } from './GridDetailsContent';
import type { PageHeaderProps } from './PageHeader';

import { GridDetailsContent } from './GridDetailsContent';
import { PageLayout } from './PageLayout';
import { PageHeader } from './PageHeader';

/** Standalone collection configuration with row-driven details. */
export interface CollectionDetailsPageProps<T> extends GridDetailsContentProps<T> {
  headerProps: PageHeaderProps;
}

/** Composes a page header, single-selection grid, and responsive details panel. */
export function CollectionDetailsPage<T>({
  headerProps,
  ...contentProps
}: CollectionDetailsPageProps<T>) {
  return (
    <PageLayout header={<PageHeader {...headerProps} />} scrollMode="panes">
      <GridDetailsContent {...contentProps} />
    </PageLayout>
  );
}
