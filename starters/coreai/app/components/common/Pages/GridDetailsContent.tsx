// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { TableRowId } from '@coreai-ds/react-components';
import type { DataGridWithFiltersProps } from '../DataGridWithFilters/DataGridWithFilters';
import type { PanelDetails } from './DetailsLayout';

import { useRef, useState } from 'react';

import { DataGridWithFilters } from '../DataGridWithFilters/DataGridWithFilters';
import { DetailsLayout } from './DetailsLayout';

/** Single-selection grid configuration with caller-rendered details. */
export interface GridDetailsContentProps<T> {
  /** Supply stable getRowId values; selection is owned by this composition. */
  dataGridProps: Omit<
    DataGridWithFiltersProps<T>,
    'selectionMode' | 'selectedItems' | 'onSelectionChange'
  >;
  /** Returns details for the selected row, or undefined to hide the panel. */
  renderDetails: (itemId: TableRowId) => PanelDetails | undefined;
}

/** Owns row selection, responsive details, and focus restoration when details close. */
export function GridDetailsContent<T>({
  dataGridProps,
  renderDetails,
}: GridDetailsContentProps<T>) {
  const [selectedId, setSelectedId] = useState<TableRowId | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedExists =
    selectedId !== null &&
    dataGridProps.items.some(
      (item, index) => (dataGridProps.getRowId?.(item) ?? index) === selectedId,
    );

  if (selectedId !== null && !selectedExists) setSelectedId(null);

  return (
    <DetailsLayout
      details={selectedExists ? renderDetails(selectedId) : undefined}
      onClose={() => setSelectedId(null)}
      returnFocusRef={returnFocusRef}
    >
      <div ref={gridRef} tabIndex={-1}>
        <DataGridWithFilters
          {...dataGridProps}
          selectionMode="single"
          selectedItems={selectedId === null ? [] : [selectedId]}
          onSelectionChange={(event, data) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            returnFocusRef.current =
              target
                ?.closest('[role="row"]')
                ?.querySelector<HTMLInputElement>('input[type="radio"]') ??
              target ??
              gridRef.current;
            setSelectedId(data.selectedItems.values().next().value ?? null);
          }}
        />
      </div>
    </DetailsLayout>
  );
}
