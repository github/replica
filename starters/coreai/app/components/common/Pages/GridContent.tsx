// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { DataGridWithFiltersProps } from '../DataGridWithFilters/DataGridWithFilters';

import { DataGridWithFilters } from '../DataGridWithFilters/DataGridWithFilters';
import { PageBody } from './PageBody';

/** Grid configuration shared by standalone collections and nested content. */
export interface GridContentProps<T> {
  dataGridProps: DataGridWithFiltersProps<T>;
}

/** Renders a padded, scrollable grid without adding a page header. */
export function GridContent<T>({ dataGridProps }: GridContentProps<T>) {
  return (
    <PageBody scrollable>
      <DataGridWithFilters {...dataGridProps} />
    </PageBody>
  );
}
