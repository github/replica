// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ResourceNotFoundProps } from '../ResourceNotFound/ResourceNotFound';
import type {
  DataGridCellFocusMode,
  DataGridProps,
  DataGridRowProps,
  SearchBoxProps as FluentSearchBoxProps,
  TableColumnDefinition as FluentTableColumnDefinition,
  TableColumnId,
  TableRowId,
} from '@coreai-ds/react-components';
import type { JSX } from 'react';

import {
  Combobox,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  SearchBox,
  Spinner,
  Text,
  Tooltip,
  useComboboxFilter,
} from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { useCallback, useMemo, useRef, useState } from 'react';
import { PaginationControls } from '../PaginationControls/PaginationControls';
import { ResourceNotFound } from '../ResourceNotFound/ResourceNotFound';

import styles from './DataGridWithFilters.module.css';

const DEFAULT_PAGE_SIZE = 25;

type GridState = 'normal' | 'empty' | 'loading' | 'filtered-empty';

type InteractiveChildren = 'none' | 'single' | 'multiple';
type InteractiveChildrenWithFunction<T = never> =
  InteractiveChildren | ((item: T) => InteractiveChildren);

interface ColumnFilterOptions<T = never> {
  /**
   * Whether to show a filter dropdown for this column.
   */
  showFilter: boolean;
  /**
   * Label for the filter dropdown. Must be a localized string, and cannot be empty.
   */
  label: string;
  /**
   * The list of options to show in the filter dropdown.
   * For simple columns (`renderCell` returns string, number, null, or undefined),
   * if this is not provided, options will be derived from the returned cell values.
   * For complex columns (`renderCell` returns JSX.Element), this must be provided.
   */
  options?: { children: string; value: string }[] | string[]; // If not provided, options will be derived from the returned cell values
  /**
   * In uncontrolled mode, this is used to determine if an item matches the selected filter option.
   * If not provided, the column's `onSearch` function will be used when available. Otherwise,
   * simple rendered cell values are compared to the selected option using an exact match.
   * Typically, search is done with a partial, case-insesitive match, but column filters use exact match, so having
   * different implementations is common.
   */
  onFilter?: (item: T, option: string) => boolean;
  /**
   * Callback invoked when the user selects an option from the filter dropdown.
   * Must be provided if the DataGrid is used in controlled mode (i.e., parent manages the filter state).
   */
  onFilterChange?: (selectedOption: string) => void;
}

interface BaseTableColumnDefinition<T = never> extends FluentTableColumnDefinition<T> {
  /**
   * Search callback for this column, when client-side search is used.
   * If search is enabled (`enableSearch` on DataGrid is not false), at least one
   * column must provide this function for client-side search to work.
   *
   * When `onSearch` is provided directly to the DataGrid, that function is used instead
   * and the parent component is responsible for performing the search and filtering the items.
   *
   * @param searchTerm
   * @param item
   * @returns true if row matches the search term, false otherwise
   */
  onSearch?: (searchTerm: string, item: T) => boolean;
  /**
   * Defines how the cell should handle focus when it contains interactive elements.
   *
   * - 'none': The cell has no interactive elements. The cell itself receives focus.
   * - 'single': The cell contains a single interactive element (e.g. a link or button).
   *             The cell itself does not receive focus, but the interactive element does.
   * - 'multiple': The cell contains multiple interactive elements (e.g. a list of links or buttons).
   *               The user can press Enter when focused on the cell to enter a focus trap and navigate
   *               between the interactive elements using Tab.
   *
   * If the cell returns a simple type (string, number, null, or undefined), this property must
   * not be set or must be set to 'none'.
   *
   * Alternatively, this property can be a function that takes the row item as an argument
   * and returns one of the above values. This allows for dynamic focus behavior based on the row data.
   */
  interactiveChildren?: InteractiveChildrenWithFunction<T>;
  /**
   * Focus behavior for interactive elements in the column header.
   * - 'none': The header cell contains no interactive elements (default)
   * - 'single': The header cell contains a single focusable element (e.g., a button or link with tooltip).
   *             The header cell itself will not be focusable, but the element inside will be.
   * - 'multiple': The header cell contains multiple focusable elements.
   *               The user can press Enter to enter a focus trap and navigate between elements using Tab.
   */
  interactiveHeaderChildren?: InteractiveChildren;
  /**
   * Tooltip text to display when the header cell receives keyboard focus or hover.
   * The tooltip is rendered by the DataGrid on the header cell element itself,
   * so it works with arrow key navigation without changing focusMode.
   */
  headerTooltip?: string;
}

interface SimpleTableColumnDefinition<T = never> extends BaseTableColumnDefinition<T> {
  renderCell: (item: T) => string | number | null | undefined;
  interactiveChildren?: 'none';
  filterOptions?: ColumnFilterOptions<T>;
}

interface ComplexTableColumnDefinition<T = never> extends BaseTableColumnDefinition<T> {
  renderCell: (item: T) => JSX.Element;
  interactiveChildren: InteractiveChildrenWithFunction<T>;
  filterOptions?: Omit<ColumnFilterOptions<T>, 'options'> &
    Required<Pick<ColumnFilterOptions<T>, 'options'>>;
}

export type TableColumnDefinition<T = never> =
  SimpleTableColumnDefinition<T> | ComplexTableColumnDefinition<T>;

// Common pagination properties
export interface BasePaginationOptions {
  currentPage?: number;
  maxItemsPerPage?: number;
}

// Controlled pagination options (parent manages state)
export interface ControlledPaginationOptions extends BasePaginationOptions {
  onNextClicked: () => void;
  onPrevClicked: () => void;
  isNextEnabled: () => boolean;
  isPrevEnabled: () => boolean;
  onSort?: (columnId: TableColumnId, direction: SortOrder) => void;
  totalItems?: number;
}

export type PaginationOptions = BasePaginationOptions | ControlledPaginationOptions;

export type SortOrder = 'ascending' | 'descending';

export type DataGridWithFiltersProps<T = never> = Omit<
  DataGridProps,
  'columns' | 'items' | 'getRowId'
> & {
  columns: TableColumnDefinition<T>[];
  items: T[];
  getRowId?: (item: T) => TableRowId;
  /**
   * Whether to show the search box.
   * @default true
   */
  enableSearch?: boolean;
  searchLabel?: string;
  onSearch?: (searchTerm: string) => void;
  searchValue?: string;
  /**
   * Optional accessible label for the select row radio button or checkbox
   * when `selectionMode` is set to 'single' or 'multiselect'.
   * Will default to "Select row" if not provided.
   */
  selectRowIndicatorLabel?: string;
  /**
   * Optional accessible label for the select all checkbox
   * when `selectionMode` is set to 'multiselect'.
   * Will default to "Select all rows" if not provided.
   */
  selectAllIndicatorLabel?: string;
  /**
   * Configuration for pagination.
   * Pagination is enabled by default.
   */
  paginationOptions?: PaginationOptions;
  /**
   * Whether to show pagination controls (previous/next buttons).
   * @default true
   */
  showPaginationControls?: boolean;
  /**
   * Whether to show pagination info (e.g., "Showing 1-25 of 100 items").
   * @default true
   */
  showPaginationInfo?: boolean;
  /**
   * Configuration for empty state when the list is empty with no search/filters.
   * Will be shown instead of the table when there are no items to display.
   */
  emptyState?: ResourceNotFoundProps;
  /**
   * Configuration for when the list is empty with any search or filter.
   * Will be shown instead of the table when there are no items to display.
   *
   * NOTE: If you are prefiltering your data before passing it to the DataGrid, the `emptyState`
   * will be shown whenever the prefiltered data is empty. The `noResultsState` will be shown
   * whenever the prefiltered data is not empty, but the applied filters or search query result
   * in no matching items.
   */
  noResultsState?: ResourceNotFoundProps;
  /**
   * If true, will show a loading indicator instead of the table content.
   */
  isLoading?: boolean;
  /**
   * Message to show next to the loading indicator. Should be a localized string. Will use a default if not provided.
   */
  loadingMessage?: string;
  /**
   * Optional JSX elements to render as actions in the controls bar,
   * positioned after the search box on the left side.
   */
  actions?: JSX.Element | JSX.Element[];
  /**
   * Position of the optional actions, relative to the search box.
   * @default 'after-search'
   */
  actionsPosition?: 'before-search' | 'after-search';
  /**
   * Actions are aligned in a row on large screens.
   * This property controls their vertical alignment.
   * - 'center' (default): Align actions vertically centered.
   * - 'end': Align actions to the bottom.
   * On small screens actions will be aligned in a column and this property has no effect.
   * @default 'center'
   */
  actionsVerticalAlign?: 'center' | 'end';
  /**
   * Optional JSX elements to render as actions at the end (right side) of the controls bar.
   */
  endActions?: JSX.Element | JSX.Element[];
  /**
   * Optional JSX content to render below the controls bar and above the grid.
   */
  belowControls?: JSX.Element;
  /**
   * Optional function to get a custom className for a row based on the item.
   * Useful for applying conditional styling to rows.
   */
  getRowClassName?: (item: T) => string | undefined;
};

/**
 * This is a wrapper around Fluent's DataGrid component with better type safety
 * and extra functionality, including search and pagination.
 */
export function DataGridWithFilters<T = never>({
  columns,
  items,
  searchLabel,
  paginationOptions,
  onSearch,
  searchValue,
  selectionMode,
  selectRowIndicatorLabel,
  selectAllIndicatorLabel,
  emptyState,
  noResultsState,
  isLoading,
  loadingMessage,
  actions,
  actionsPosition = 'after-search',
  actionsVerticalAlign = 'center',
  endActions,
  belowControls,
  enableSearch = true,
  showPaginationControls = true,
  showPaginationInfo = true,
  resizableColumns,
  resizableColumnsOptions,
  columnSizingOptions,
  getRowClassName,
  ...props
}: DataGridWithFiltersProps<T>): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | number | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending'>('ascending');
  const [appliedFilters, setAppliedFilters] = useState<ReadonlyMap<TableColumnId, string>>(
    new Map(),
  );

  // Wrap setAppliedFilters so any change to column filters resets pagination
  // to page 1, mirroring the search and sort handlers. Without this, the
  // current page can exceed the filtered total pages and render an empty grid.
  const handleAppliedFiltersChange = useCallback<
    React.Dispatch<React.SetStateAction<ReadonlyMap<TableColumnId, string>>>
  >((update) => {
    setAppliedFilters(update);
    setCurrentPage(1);
  }, []);

  const isControlled = isControlledPagination(paginationOptions);

  const filteredItems = useMemo(() => {
    const trimmedSearchTerm = searchTerm.trim();

    // If the component is controlled, we don't apply any filtering or sorting.
    let filtered = items;

    // For uncontrolled mode, apply filtering from searchbox and column filters, and sort by selected column
    if (!isControlled) {
      // Apply search term filtering first; skip if search is controlled by parent
      if (onSearch == null) {
        filtered =
          trimmedSearchTerm === ''
            ? filtered
            : filtered.filter((item) =>
                columns.some((column) => {
                  const found = column.onSearch?.(trimmedSearchTerm, item);
                  if (found) {
                    return true;
                  }
                  return false;
                }),
              );
      }

      // Apply column filters
      for (const [columnId, option] of appliedFilters.entries()) {
        const column = columns.find((col) => col.columnId === columnId);
        if (column?.filterOptions?.onFilterChange) {
          // Filter is controlled by parent, skip
        } else if (column?.filterOptions?.onFilter) {
          filtered = filtered.filter((item) => column.filterOptions?.onFilter?.(item, option));
        } else if (column?.onSearch) {
          filtered = filtered.filter((item) => column.onSearch?.(option, item));
        } else if (column) {
          filtered = filtered.filter((item) => {
            const cellValue = column.renderCell(item);
            return (
              (typeof cellValue === 'string' || typeof cellValue === 'number') &&
              String(cellValue).trim() === option
            );
          });
        }
      }

      // Apply sorting for uncontrolled mode
      if (sortColumn !== undefined) {
        const column = columns.find((col) => col.columnId === sortColumn);
        if (column?.compare) {
          filtered = [...filtered].sort((a, b) => {
            const result = column.compare(a, b);
            return sortDirection === 'ascending' ? result : -result;
          });
        }
      }
    }

    return filtered;
  }, [
    searchTerm,
    items,
    isControlled,
    onSearch,
    sortColumn,
    columns,
    appliedFilters,
    sortDirection,
  ]);

  const columnInteractiveChildren = useMemo(
    () => Object.fromEntries(columns.map((col) => [col.columnId, col.interactiveChildren])),
    [columns],
  );

  // Calculate pagination values
  let totalPages = 1;
  let paginatedItems;

  if (isControlled) {
    // For controlled pagination, we don't track total pages
    paginatedItems = items;
  } else {
    const uncontrolledOptions = isUncontrolledPagination(paginationOptions)
      ? paginationOptions
      : undefined;

    const maxItemsPerPage = uncontrolledOptions?.maxItemsPerPage ?? DEFAULT_PAGE_SIZE;

    totalPages = Math.max(1, Math.ceil(filteredItems.length / maxItemsPerPage));
    const startIndex = (currentPage - 1) * maxItemsPerPage;
    paginatedItems = filteredItems.slice(startIndex, startIndex + maxItemsPerPage);
  }

  const handleSearch: NonNullable<FluentSearchBoxProps['onChange']> = (ev, data) => {
    setSearchTerm(data.value);
    setCurrentPage(1);

    if (onSearch) {
      onSearch(data.value);
    }
  };

  const scrollToTop = () => {
    // This must be wrapped in a setTimeout to push to the next event loop cycle,
    // otherwise this won't scroll when going to the last page or returning to the first page
    // I cannot figure out exactly why...
    window.setTimeout(() => {
      containerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      // Move focus to search box after pagination for logical focus order (MAS 2.4.3)
      searchRef.current?.focus();
    }, 0);
  };

  const handlePreviousPage = () => {
    if (isControlled) {
      paginationOptions.onPrevClicked();
    } else {
      setCurrentPage((prev) => Math.max(1, prev - 1));
    }
    scrollToTop();
  };

  const handleNextPage = () => {
    if (isControlled) {
      paginationOptions.onNextClicked();
    } else {
      setCurrentPage((prev) => Math.min(totalPages, prev + 1));
    }
    scrollToTop();
  };

  const handleSortChange: NonNullable<DataGridProps['onSortChange']> = (e, sortState) => {
    if (!isControlled) {
      // Reset to first page when sort changes for uncontrolled pagination
      setCurrentPage(1);

      if (sortState.sortColumn === undefined) {
        // Clear sorting when no column is selected
        setSortColumn(undefined);
        setSortDirection('ascending');
      } else {
        // Update sort state for uncontrolled mode
        setSortColumn(sortState.sortColumn);
        setSortDirection(sortState.sortDirection);
      }
    } else if (paginationOptions.onSort && sortState.sortColumn !== undefined) {
      paginationOptions.onSort(sortState.sortColumn, sortState.sortDirection);
    }
  };

  const displayCurrentPage = isControlled
    ? (paginationOptions.currentPage ?? currentPage)
    : currentPage;

  const itemRangeText = useMemo(() => {
    if (isControlled && paginationOptions.totalItems === undefined) {
      return '';
    }

    const totalItems =
      isControlled && paginationOptions.totalItems !== undefined
        ? paginationOptions.totalItems
        : filteredItems.length;

    const pageSize = paginationOptions?.maxItemsPerPage ?? DEFAULT_PAGE_SIZE;

    const start = totalItems === 0 ? 0 : (displayCurrentPage - 1) * pageSize + 1;
    const end = totalItems === 0 ? 0 : Math.min(start + pageSize - 1, totalItems);

    return `${start}-${end} of ${totalItems}`;
  }, [filteredItems.length, displayCurrentPage, isControlled, paginationOptions]);

  const searchLabelText = searchLabel ?? 'Search';

  const sortable =
    props.sortable === true || (isControlled && paginationOptions.onSort !== undefined);

  const isPrevButtonDisabled = isControlled
    ? !paginationOptions.isPrevEnabled()
    : displayCurrentPage <= 1;

  const isNextButtonDisabled = isControlled
    ? !paginationOptions.isNextEnabled()
    : displayCurrentPage >= totalPages;

  const selectionCell: DataGridRowProps['selectionCell'] =
    selectionMode === 'single'
      ? {
          radioIndicator: {
            'aria-label': selectRowIndicatorLabel ?? 'Select row',
          },
        }
      : selectionMode === 'multiselect'
        ? {
            checkboxIndicator: {
              'aria-label': selectRowIndicatorLabel ?? 'Select row',
            },
          }
        : undefined;

  const headerSelectionCell: DataGridRowProps['selectionCell'] =
    selectionMode === 'multiselect'
      ? {
          checkboxIndicator: {
            'aria-label': selectAllIndicatorLabel ?? 'Select all rows',
          },
        }
      : selectionMode === 'single'
        ? {
            invisible: true,
            radioIndicator: {
              'aria-label': selectAllIndicatorLabel ?? 'Select all rows',
              disabled: true, // Header radio button is always disabled
            },
          }
        : undefined;

  const gridState: GridState = isLoading
    ? 'loading'
    : filteredItems.length === 0
      ? items.length > 0
        ? 'filtered-empty'
        : 'empty'
      : 'normal';

  const emptyStateFinal = useGridEmptyState({
    isFiltered: searchTerm !== '' || appliedFilters.size > 0,
    emptyState,
    noResultsState,
  });

  const minWidth = getGridMinimumWidth(columns, columnSizingOptions, selectionMode);

  return (
    <div ref={containerRef} className={styles.datagridContainer}>
      <div
        className={clsx(
          styles.controlsBar,
          actionsVerticalAlign === 'end' && styles.controlsVerticalAlignEnd,
        )}
      >
        {actionsPosition === 'before-search' ? actions : null}
        {enableSearch ? (
          <SearchBox
            ref={searchRef}
            aria-label={searchLabelText}
            className={styles.searchBox}
            onChange={handleSearch}
            placeholder={searchLabelText}
            value={isControlled && searchValue ? searchValue : searchTerm}
          />
        ) : null}
        <FilterDropdowns
          appliedFilters={appliedFilters}
          columns={columns}
          items={items}
          setAppliedFilters={handleAppliedFiltersChange}
        />
        {actionsPosition === 'after-search' ? actions : null}
        {endActions ? (
          <>
            <div className={styles.flexSpacer} />
            <div className={styles.endActions}>{endActions}</div>
          </>
        ) : null}
      </div>
      {belowControls}
      {gridState === 'normal' ? (
        <>
          <div className={styles.scrollContainer}>
            <DataGrid
              className={styles.grid}
              columnSizingOptions={columnSizingOptions}
              columns={columns}
              items={paginatedItems}
              onSortChange={handleSortChange}
              resizableColumns={resizableColumns}
              resizableColumnsOptions={resizableColumnsOptions}
              selectionMode={selectionMode}
              sortable={sortable}
              style={
                {
                  '--gridMinWidth': minWidth,
                } as React.CSSProperties
              }
              {...props}
            >
              <DataGridHeader>
                <DataGridRow selectionCell={headerSelectionCell}>
                  {({ renderHeaderCell, columnId }) => {
                    const column = columns.find((col) => col.columnId === columnId);
                    const headerCell = (
                      <DataGridHeaderCell
                        className={styles.gridCell}
                        focusMode={getFocusMode(column?.interactiveHeaderChildren, undefined)}
                        {...(resizableColumns
                          ? {}
                          : {
                              style: {
                                '--cellMinWidth': columnSizingOptions?.[columnId]?.minWidth,
                              } as React.CSSProperties,
                            })}
                      >
                        {renderHeaderCell()}
                      </DataGridHeaderCell>
                    );
                    return column?.headerTooltip ? (
                      <Tooltip
                        content={column.headerTooltip}
                        positioning="below-start"
                        relationship="description"
                      >
                        {headerCell}
                      </Tooltip>
                    ) : (
                      headerCell
                    );
                  }}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<T>>
                {({ item, rowId }) => (
                  <DataGridRow<T>
                    key={rowId}
                    className={getRowClassName?.(item)}
                    selectionCell={selectionCell}
                  >
                    {({ renderCell, columnId }) => (
                      <DataGridCell
                        className={styles.gridCell}
                        focusMode={getFocusMode(columnInteractiveChildren[columnId], item)}
                        onClick={getRowClickSelectionPreventer(selectionMode)}
                        onKeyDown={getRowKeyboardSelectionPreventer(selectionMode)}
                        {...(resizableColumns
                          ? {}
                          : {
                              style: {
                                '--cellMinWidth': columnSizingOptions?.[columnId]?.minWidth,
                              } as React.CSSProperties,
                            })}
                      >
                        {renderCell(item)}
                      </DataGridCell>
                    )}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          </div>
          {showPaginationInfo || showPaginationControls ? (
            <div className={styles.gridFooter}>
              {showPaginationInfo ? (
                <Text foreground={2} preset="bodyS">
                  {itemRangeText}
                </Text>
              ) : null}
              {showPaginationControls ? (
                <PaginationControls
                  isNextDisabled={isNextButtonDisabled}
                  isPrevDisabled={isPrevButtonDisabled}
                  onNextClicked={handleNextPage}
                  onPrevClicked={handlePreviousPage}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {gridState === 'loading' ? (
        <div className={styles.loadingContainer} role="status">
          <Spinner label={loadingMessage ?? 'Loading...'} />
        </div>
      ) : null}
      {searchTerm || searchValue ? (
        <div aria-live="polite" role="status">
          {gridState === 'empty' ? (
            <div key={searchTerm} className={styles.emptyStateContainer}>
              <ResourceNotFound
                className={emptyStateFinal.className}
                description={emptyStateFinal.description}
                headingLevel={emptyStateFinal.headingLevel}
                title={emptyStateFinal.title}
                topContent={emptyStateFinal.topContent}
              >
                {emptyStateFinal.children}
              </ResourceNotFound>
            </div>
          ) : null}
        </div>
      ) : gridState === 'empty' ? (
        <div className={styles.emptyStateContainer}>
          <ResourceNotFound
            className={emptyStateFinal.className}
            description={emptyStateFinal.description}
            headingLevel={emptyStateFinal.headingLevel}
            title={emptyStateFinal.title}
            topContent={emptyStateFinal.topContent}
          >
            {emptyStateFinal.children}
          </ResourceNotFound>
        </div>
      ) : null}
      <div aria-live="polite" role="status">
        {gridState === 'filtered-empty' ? (
          <div key={searchTerm} className={styles.emptyStateContainer}>
            <ResourceNotFound {...emptyStateFinal} />
          </div>
        ) : null}
      </div>
      <SearchResultAnnouncement
        appliedFiltersSize={appliedFilters.size}
        currentPage={displayCurrentPage}
        filteredItemsLength={gridState === 'normal' ? filteredItems.length : 0}
        maxItemsPerPage={paginationOptions?.maxItemsPerPage}
        searchTerm={isControlled ? (searchValue ?? searchTerm) : searchTerm}
        totalItems={isControlled ? paginationOptions.totalItems : filteredItems.length}
        visibleItemsLength={paginatedItems.length}
      />
    </div>
  );
}

interface SearchResultAnnouncementProps {
  searchTerm: string;
  appliedFiltersSize: number;
  filteredItemsLength: number;
  currentPage: number;
  totalItems?: number;
  maxItemsPerPage?: number;
  visibleItemsLength: number;
}

function SearchResultAnnouncement({
  searchTerm,
  appliedFiltersSize,
  filteredItemsLength,
  currentPage,
  totalItems,
  maxItemsPerPage,
  visibleItemsLength,
}: SearchResultAnnouncementProps): JSX.Element {
  const announcement = useMemo(() => {
    // Only announce when there's an active search term or filter
    const trimmedSearchTerm = searchTerm.trim();
    const hasActiveFilter = trimmedSearchTerm !== '' || appliedFiltersSize > 0;
    if (!hasActiveFilter || filteredItemsLength === 0 || visibleItemsLength === 0) {
      // No announcement needed - empty state is handled separately with its own aria-live
      return '';
    }

    const pageSize = maxItemsPerPage ?? DEFAULT_PAGE_SIZE;
    const searchContext = trimmedSearchTerm ? ` for "${trimmedSearchTerm}"` : '';
    const filterContext =
      appliedFiltersSize > 0
        ? trimmedSearchTerm
          ? ' with the selected filters'
          : ' matching the selected filters'
        : '';
    const context = `${searchContext}${filterContext}`;

    // Use simple announcement when pagination doesn't matter (single page)
    if (totalItems !== undefined && totalItems <= pageSize) {
      return `${totalItems} ${totalItems === 1 ? 'result' : 'results'} found${context}.`;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = start + visibleItemsLength - 1;
    const range = visibleItemsLength === 1 ? `${start}` : `${start}-${end}`;
    const total = totalItems === undefined ? '' : ` of ${totalItems}`;

    return `Showing ${visibleItemsLength === 1 ? 'result' : 'results'} ${range}${total}${context}.`;
  }, [
    searchTerm,
    appliedFiltersSize,
    filteredItemsLength,
    currentPage,
    totalItems,
    maxItemsPerPage,
    visibleItemsLength,
  ]);

  return (
    <span aria-live="polite" className={styles.visuallyHidden} role="status">
      {announcement}
    </span>
  );
}

function isControlledPagination(
  options?: PaginationOptions,
): options is ControlledPaginationOptions {
  if (!options) {
    return false;
  }

  return (
    'onNextClicked' in options &&
    'onPrevClicked' in options &&
    'isPrevEnabled' in options &&
    'isNextEnabled' in options
  );
}

function isUncontrolledPagination(options?: PaginationOptions): options is BasePaginationOptions {
  return Boolean(options) && !isControlledPagination(options);
}

function getFocusMode<T = never>(
  interactiveChildren: InteractiveChildrenWithFunction<T> | undefined,
  item: T,
): DataGridCellFocusMode | undefined {
  const finalInteractiveChildren: InteractiveChildren | undefined =
    typeof interactiveChildren === 'function' ? interactiveChildren(item) : interactiveChildren;

  switch (finalInteractiveChildren) {
    case 'none': {
      return 'cell';
    }
    case 'single': {
      return 'none';
    }
    case 'multiple': {
      return 'group';
    }
    case undefined: {
      return undefined;
    }
  }
}

function FilterDropdowns<T = never>({
  items,
  columns,
  appliedFilters,
  setAppliedFilters,
}: {
  items: T[];
  columns: TableColumnDefinition<T>[];
  appliedFilters: ReadonlyMap<TableColumnId, string>;
  setAppliedFilters: React.Dispatch<React.SetStateAction<ReadonlyMap<TableColumnId, string>>>;
}) {
  const columnsWithFilters = useMemo(
    () => columns.filter((col) => col.filterOptions?.showFilter === true),
    [columns],
  );

  if (columnsWithFilters.length === 0) {
    return null;
  }

  return (
    <>
      {columnsWithFilters.map((col) => (
        <FilterDropdown<T>
          key={col.columnId}
          column={col}
          items={items}
          onSelectionChange={(option) => {
            setAppliedFilters((prev) => {
              const newMap = new Map(prev);
              if (option === '') {
                newMap.delete(col.columnId);
              } else {
                newMap.set(col.columnId, option);
              }
              return newMap;
            });
          }}
          selectedOption={appliedFilters.get(col.columnId)}
        />
      ))}
    </>
  );
}

function FilterDropdown<T = never>({
  items,
  column,
  selectedOption,
  onSelectionChange,
}: {
  items: T[];
  column: TableColumnDefinition<T>;
  selectedOption: string | undefined;
  onSelectionChange: (option: string) => void;
}) {
  const { filterOptions } = column;

  const options = useMemo(() => {
    if (!filterOptions?.showFilter) {
      return [];
    }

    let currentOptions: Required<ColumnFilterOptions<T>['options']> = filterOptions.options;

    if (currentOptions == null) {
      const uniqueOptions = new Set(
        items.map((item) => {
          const cellValue = column.renderCell(item);
          if (typeof cellValue === 'string' || typeof cellValue === 'number') {
            return String(cellValue).trim();
          }
          return null;
        }),
      );

      currentOptions = [...uniqueOptions]
        .filter((o) => o != null)
        .filter((o) => o !== '')
        .sort();
    }

    return currentOptions;
  }, [column, filterOptions, items]);

  const [query, setQuery] = useState('');
  const filteredOptions = useComboboxFilter<(typeof options)[number]>(query, options, {
    noOptionsMessage: 'No results found',
    optionToText: (o) => (typeof o === 'string' ? o : o.children),
  });

  const handleSelectionChange = useCallback(
    (option: string) => {
      setQuery('');
      onSelectionChange(option);

      if (filterOptions?.onFilterChange) {
        filterOptions.onFilterChange(option);
      }
    },
    [filterOptions, onSelectionChange],
  );

  const visibleSelection: string = useMemo(() => {
    if (query) {
      return query;
    }

    if (selectedOption) {
      if (typeof options.at(0) === 'string') {
        return selectedOption;
      }

      if (typeof options.at(0) === 'object') {
        const matchingOption = (options as { children: string; value: string }[]).find(
          (o) => typeof o === 'object' && o.value === selectedOption,
        );
        return matchingOption?.children ?? selectedOption;
      }
    }

    return '';
  }, [options, query, selectedOption]);

  if (!filterOptions?.showFilter) {
    return null;
  }

  return (
    <Combobox
      aria-label={`Filter by ${filterOptions.label}`}
      clearable={true}
      dynamicWidth={true}
      label={filterOptions.label}
      onChange={(ev) => {
        setQuery(ev.target.value);
      }}
      onOptionSelect={(ev, data) => {
        const option = data.optionValue ?? '';
        handleSelectionChange(option);
      }}
      placeholder="Type to filter..."
      selectedOptions={selectedOption ? [selectedOption] : []}
      value={visibleSelection}
    >
      {filteredOptions}
    </Combobox>
  );
}

function useGridEmptyState({
  isFiltered,
  emptyState,
  noResultsState,
}: {
  isFiltered: boolean;
  emptyState?: ResourceNotFoundProps;
  noResultsState?: ResourceNotFoundProps;
}): ResourceNotFoundProps {
  // If empty state is not provided, use default empty text.
  const emptyStateToUse = emptyState ?? {
    title: 'No data available',
    description: '',
  };

  // If no results state is not provided, fall back to empty state.
  // If that is also not provided, use default no results text.
  const noResultsStateToUse = noResultsState ??
    emptyState ?? {
      title: 'No results found',
      description: '',
    };

  return isFiltered ? noResultsStateToUse : emptyStateToUse;
}

const DEFAULT_COLUMN_MIN_WIDTH = 100;
/**
 * Width of the selection column in pixels.
 * This value matches TABLE_SELECTION_CELL_WIDTH from @fluentui/react-table.
 * @see https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-table/library/src/components/TableSelectionCell/useTableSelectionCell.ts
 */
const SELECTION_COLUMN_WIDTH = 44;
function getGridMinimumWidth<T = never>(
  columns: TableColumnDefinition<T>[],
  columnSizingOptions: DataGridProps['columnSizingOptions'],
  selectionMode: DataGridProps['selectionMode'],
): number {
  let totalMinWidth = 0;

  // Add selection column width if selection is enabled
  if (selectionMode === 'single' || selectionMode === 'multiselect') {
    totalMinWidth += SELECTION_COLUMN_WIDTH;
  }

  for (const column of columns) {
    const { columnId } = column;
    const columnSizing = columnSizingOptions?.[columnId];
    totalMinWidth += columnSizing?.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH;
  }

  return totalMinWidth;
}

function stopPropagation(e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
  // Stop propagation if event originated from a button, link, or other interactive element.
  // This prevents the row from being selected
  const target = e.target as HTMLElement;
  const interactiveTargetElement = target.closest(
    'button, a, input, textarea, select, [role=button], [role=menu]',
  );
  if (interactiveTargetElement) {
    e.stopPropagation();
  }
}

function getRowClickSelectionPreventer(selectionMode: DataGridProps['selectionMode']) {
  if (selectionMode === 'single' || selectionMode === 'multiselect') {
    return (e: React.MouseEvent<HTMLElement>) => {
      stopPropagation(e);
    };
  }

  return undefined;
}

function getRowKeyboardSelectionPreventer(selectionMode: DataGridProps['selectionMode']) {
  if (selectionMode === 'single' || selectionMode === 'multiselect') {
    return (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        stopPropagation(e);
      }
    };
  }

  return undefined;
}
