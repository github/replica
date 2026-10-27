// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { TableColumnDefinition } from './DataGridWithFilters';

import { Button, Tooltip } from '@coreai-ds/react-components';
import { InfoRegular, LockClosedRegular } from '@fluentui/react-icons';

import styles from './DataGridWithFilters.module.css';

/**
 * Enhances a column definition with optional disabled state and/or info tooltip.
 *
 * When disabled, the column cannot be sorted and its header displays a lock icon
 * with an optional tooltip explaining why it's disabled. The info icon is NOT shown
 * when the column is disabled.
 *
 * When not disabled and an info tooltip is provided, the header displays an info icon
 * and the tooltip appears on hover or keyboard focus.
 *
 * @param column - The base column definition to enhance
 * @param options - Optional configuration for disabled state and info tooltip
 * @returns The enhanced column definition
 *
 * @example
 * ```tsx
 * const columns = [
 *   // Info tooltip only
 *   createColumn(baseColumn, {
 *     infoTooltip: { content: 'A unique identifier for the conversation' },
 *   }),
 *   // Disabled with tooltip, info tooltip suppressed when disabled
 *   createColumn(baseColumn, {
 *     disabled: {
 *       isDisabled: !hasPermission,
 *       tooltip: 'Requires Application Insights permissions',
 *     },
 *     infoTooltip: { content: 'Trace ID for the request' },
 *   }),
 * ];
 * ```
 */
export function createColumn<T>(
  column: TableColumnDefinition<T>,
  options?: {
    disabled?: {
      isDisabled: boolean;
      tooltip?: string;
    };
    infoTooltip?: {
      content: string;
    };
  },
): TableColumnDefinition<T> {
  if (!options) {
    return column;
  }

  const isDisabled = options.disabled?.isDisabled === true;
  const originalRenderHeaderCell = column.renderHeaderCell;

  const result: TableColumnDefinition<T> = { ...column };

  // Info tooltip: add headerTooltip and info icon to header
  if (options.infoTooltip && !isDisabled) {
    result.headerTooltip = options.infoTooltip.content;
    result.renderHeaderCell = (data?: unknown) => (
      <span className={styles.infoTooltipHeaderCell}>
        <span>{originalRenderHeaderCell(data)}</span>
        <InfoRegular aria-hidden={true} className={styles.infoTooltipHeaderIcon} fontSize={16} />
      </span>
    );
  }

  // Disabled: lock icon, no sorting, optional tooltip
  if (isDisabled) {
    const disabledTooltip = options.disabled?.tooltip;
    result.headerTooltip = undefined;
    result.compare = (() => 0) as typeof column.compare;
    result.interactiveHeaderChildren = 'single';
    result.renderHeaderCell = (data?: unknown) => {
      const innerContent = (
        <>
          <span>{originalRenderHeaderCell(data)}</span>
          <LockClosedRegular
            aria-hidden="true"
            className={styles.disabledHeaderIcon}
            fontSize={16}
          />
        </>
      );

      const content = (
        <Button appearance="subtle" className={styles.disabledHeaderCell} disabledFocusable={true}>
          {innerContent}
        </Button>
      );

      return disabledTooltip ? (
        <Tooltip content={disabledTooltip} positioning="below-start" relationship="description">
          {content}
        </Tooltip>
      ) : (
        content
      );
    };
  }

  return result;
}
