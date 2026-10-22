// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ICatalogItem, ISortOption } from './Catalog.types';
import type { IFilterCategory, IFilterState } from './FilterSidebar';
import type { OptionOnSelectData, SelectionEvents } from '@coreai-ds/react-components';
import type { ReactNode } from 'react';

import {
  Button,
  Dropdown,
  InteractionTag,
  InteractionTagPrimary,
  Option,
  SearchBox,
  Spinner,
  Tag,
  TagGroup,
  Text,
} from '@coreai-ds/react-components';
import { Search24Regular } from '@fluentui/react-icons';
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageBody, PageHeader, PageLayout, SidebarLayout } from '~/components/common';

import { CatalogGrid } from './CatalogGrid';
import { FilterSidebar } from './FilterSidebar';
import { useFilterGroups } from './hooks/useFilterGroups';

import styles from './CatalogView.module.css';

const MAX_VISIBLE_FILTER_VALUES = 3;

// Props for the CatalogView component
export interface ICatalogViewProps {
  /**
   * CSS class name for the container
   * Use this to apply custom styling to the catalog container
   */
  className?: string;

  /**
   * The items to display in the catalog
   * This is the main data source for the catalog
   */
  items: ICatalogItem[];

  /** Returns the detail-page URL for a catalog item. */
  getItemHref: (item: ICatalogItem) => string;

  /**
   * Whether the catalog is currently loading
   * If true, a loading spinner will be displayed instead of the grid view
   */
  isLoading?: boolean;

  /**
   * Callback when filters change
   * If provided, parent component is responsible for filtering items
   * If not provided, CatalogView will handle filtering internally
   */
  onFiltersChange?: (filters: Record<string, string[]>) => void;

  /**
   * Callback when an item is selected
   * Receives the ID of the selected item
   */
  onItemSelect?: (itemId: string) => void;

  /**
   * Callback when search text changes
   * If provided, parent component is responsible for filtering items
   * If not provided, CatalogView will handle filtering internally
   */
  onSearchChange?: (searchText: string) => void;

  /**
   * Optional custom renderer for individual items
   * Use this to override the default card rendering with custom UI
   * If not provided, items will be rendered as selectable cards
   */
  renderItem?: (item: ICatalogItem) => ReactNode;

  /**
   * Current search text value
   * If provided, the search input will be controlled by the parent component
   */
  searchText?: string;
  /**
   * Filter categories to display in the sidebar
   * If not provided, filters will be auto-generated from item properties
   */
  filterGroups?: IFilterCategory[];

  /**
   * Currently selected filters
   * If provided, the filters will be controlled by the parent component
   */
  selectedFilters?: IFilterState;

  /**
   * Sort options for the dropdown
   * Each option should provide a key, display text, and a sort function
   * If not provided, sorting controls will not be displayed
   */
  sortOptions?: ISortOption[];
  /**
   * Default sort key to use when component is first rendered
   * Should match one of the keys in sortOptions
   * Only applies if sortOptions is provided
   */
  defaultSortKey?: string;
  /**
   * Callback when sort option changes
   * Called with the selected sort key
   */
  onSortChange?: (sortKey: string) => void;
  /**
   * The title of the catalog
   * Displayed as a heading above the catalog
   */
  title: string;
  /**
   * Optional description text displayed below the title
   * Provides context or instructions for the catalog
   */
  description?: string | ReactNode;
  /**
   * Custom filter category in radio button styles to display on top of filterGroups
   */
  customFilterGroup?: IFilterCategory;
  /**
   * Currently selected custom filter option
   */
  selectedCustomFilter?: string;
  /**
   * Callback when custom filter changes
   */
  onCustomFilterChange?: (selectedCustomFilter: string) => void;
  /**
   * Whether there are more items to load
   */
  hasMore?: boolean;
  /**
   * Whether the load more operation is currently in progress
   */
  isLoadingMore?: boolean;
  /**
   * Callback when the load more button is clicked
   */
  onLoadMore?: () => void;
  /**
   * Whether to automatically scroll to show newly loaded items
   */
  autoScrollOnLoadMore?: boolean;
  totalCount?: number;
  /**
   * Optional custom action buttons to display in the header
   * These will be rendered in addition to any built-in actions (like Compare Models)
   */
  headerActionButtons?: ReactNode;
  /**
   * Pagination mode to use for loading more items
   * - 'button': Show a "Load More" button (default)
   * - 'infinite': Automatically load more items when scrolling near the bottom
   */
  paginationMode?: 'button' | 'infinite';
  /**
   * Whether to hide the filter panel
   * When true, the filter sidebar will be hidden and the catalog grid will fill the entire width
   */
  hideFilter?: boolean;
}

/**
 * CatalogView component for displaying and filtering a collection of items
 */
export function CatalogView({
  className,
  defaultSortKey,
  filterGroups: providedFilterGroups,
  getItemHref,
  isLoading,
  items,
  onFiltersChange,
  onSearchChange,
  onSortChange,
  renderItem,
  searchText: externalSearchText,
  selectedFilters: externalSelectedFilters,
  sortOptions,
  title,
  description,
  customFilterGroup,
  selectedCustomFilter,
  onCustomFilterChange,
  hasMore,
  isLoadingMore,
  onLoadMore,
  autoScrollOnLoadMore,
  totalCount,
  headerActionButtons,
  paginationMode = 'button',
  hideFilter = false,
}: ICatalogViewProps): React.ReactElement {
  const [localFilters, setFilters] = useState<IFilterState>(externalSelectedFilters ?? {});
  const [localSearchText, setSearchText] = useState<string>(externalSearchText ?? '');
  const filters = externalSelectedFilters ?? localFilters;
  const searchText = externalSearchText ?? localSearchText;
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>(externalSearchText ?? '');
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);

  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search text
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchText]);

  // Auto-scroll to show newly loaded items when load more completes (only for button mode)
  useEffect(() => {
    if (
      paginationMode === 'button' &&
      autoScrollOnLoadMore &&
      !isLoadingMore &&
      items.length > 50
    ) {
      // Double requestAnimationFrame to ensure layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const loadMoreButton = document.querySelector('[data-testid="load-more-button"]');
          if (loadMoreButton) {
            loadMoreButton.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        });
      });
    }
  }, [paginationMode, autoScrollOnLoadMore, isLoadingMore, items.length]);

  // Infinite scroll: Intersection Observer to trigger loading when sentinel comes into view
  useEffect(() => {
    if (paginationMode !== 'infinite' || !hasMore || isLoadingMore || !onLoadMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null, // Use viewport as root
        rootMargin: '200px', // Trigger 200px before reaching the sentinel
        threshold: 0,
      },
    );

    const currentRef = loadMoreSentinelRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [paginationMode, hasMore, isLoadingMore, onLoadMore]);

  // Auto-generate filter groups from items' filterProperties if none are provided
  const filterGroups = useFilterGroups(items, providedFilterGroups);

  // Apply filters to the items - uncontrolled
  const applyFilters = useCallback(
    (itemsToFilter: ICatalogItem[], currentFilters: IFilterState): ICatalogItem[] => {
      // If no filters are selected, return all items
      const activeFilters = Object.entries(currentFilters).filter(
        ([_, values]) => values.length > 0,
      );

      if (activeFilters.length === 0) {
        return itemsToFilter;
      }

      // Filter items based on selected filters
      return itemsToFilter.filter((item) =>
        // Check if the item matches all filter categories
        activeFilters.every(([categoryId, selectedValues]) => {
          // Get the item's value for this filter category
          const itemValue = item.filterProperties?.[categoryId];

          if (itemValue === undefined) {
            return false;
          }

          // Check if any of the selected values match the item's value
          return Array.isArray(itemValue)
            ? // For array values, check if any value matches any selected value
              itemValue.some((value) => selectedValues.includes(value))
            : // For string values, check if the value is in the selected values
              selectedValues.includes(itemValue);
        }),
      );
    },
    [],
  );

  // Apply search filter to items
  const applySearchFilter = useCallback(
    (itemsToFilter: ICatalogItem[], query: string): ICatalogItem[] => {
      if (!query) {
        return itemsToFilter;
      }

      const lowerCaseQuery = query.toLowerCase();
      return itemsToFilter.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(lowerCaseQuery);
        const descriptionMatch = item.description?.toLowerCase().includes(lowerCaseQuery) ?? false;
        return nameMatch || descriptionMatch;
      });
    },
    [],
  );

  // Handle search text changes
  const handleSearchChange = useCallback(
    (text: string): void => {
      setSearchText(text);

      // If external search handler is provided, use it
      if (onSearchChange) {
        onSearchChange(text);
      }
    },
    [onSearchChange],
  );

  const filteredItems = useMemo(() => {
    const matchingFilters = onFiltersChange ? items : applyFilters(items, filters);
    const matchingSearch = onSearchChange
      ? matchingFilters
      : applySearchFilter(matchingFilters, debouncedSearchText);
    const selectedSortOption = sortOptions?.find((option) => option.key === sortKey);
    return selectedSortOption?.onSort
      ? selectedSortOption.onSort([...matchingSearch])
      : matchingSearch;
  }, [
    items,
    filters,
    debouncedSearchText,
    sortKey,
    sortOptions,
    onFiltersChange,
    onSearchChange,
    applyFilters,
    applySearchFilter,
  ]);

  // Handle sort option selection
  const handleSortChange = useCallback(
    (e: SelectionEvents, data: OptionOnSelectData): void => {
      if (typeof data.optionValue === 'string') {
        setSortKey(data.optionValue);

        // Call the external sort change handler if provided
        if (onSortChange) {
          onSortChange(data.optionValue);
        }
      }
    },
    [onSortChange],
  );

  // Handle filter changes
  const handleFilterChange = useCallback(
    (newFilters: IFilterState): void => {
      setFilters(newFilters);

      if (onFiltersChange) {
        // If external filter handler provided, use it
        onFiltersChange(newFilters);
      }
    },
    [onFiltersChange],
  );

  // Handle clearing all filters
  const handleClearAllFilters = useCallback((): void => {
    searchInputRef.current?.focus();
    handleFilterChange({});
  }, [handleFilterChange]);

  // Get selected filters for display (similar to MiniCatalogView)
  const selectedFilters = useMemo(
    () =>
      Object.entries(filters)
        .filter(([_, values]) => values.length > 0)
        .map(([categoryId, values]) => {
          const filterGroup = filterGroups.find((group) => group.id === categoryId);
          const displayNames = values.map((value) => {
            const option = filterGroup?.options.find((opt) => opt.id === value);
            return option?.label ?? value;
          });
          return {
            key: categoryId,
            label: filterGroup?.title ?? '',
            values,
            displayNames,
          };
        }),
    [filters, filterGroups],
  );

  const renderControls = (sidebarTrigger: ReactNode) => (
    <div className={styles.catalogToolbar}>
      <div className={styles.controlsContainer}>
        <div className={styles.controlsContainerRow}>
          <SearchBox
            ref={searchInputRef}
            appearance="filled-lighter"
            aria-label="Search"
            className={styles.searchBarContainer}
            contentBefore={<Search24Regular aria-hidden="true" />}
            onChange={(_event, data) => {
              handleSearchChange(data.value);
            }}
            placeholder="Search"
            value={searchText}
          />
          {sortOptions && sortOptions.length > 0 ? (
            <div className={styles.sortDropdownContainer}>
              <Dropdown
                appearance="filled-lighter"
                aria-label="Sort by"
                className={styles.sortDropdown}
                label="Sort by"
                onOptionSelect={handleSortChange}
                selectedOptions={sortKey ? [sortKey] : []}
                placeholder="Sort by"
                dynamicWidth
                truncateTextOverflow={false}
                value={(() => {
                  const selectedOption = sortOptions.find(
                    (option) => option.key === (sortKey ?? defaultSortKey),
                  );
                  return selectedOption ? selectedOption.text : '';
                })()}
              >
                {sortOptions.map((option) => (
                  <Option key={option.key} value={option.key}>
                    {option.text}
                  </Option>
                ))}
              </Dropdown>
            </div>
          ) : null}
          {sidebarTrigger}
        </div>
      </div>
      {searchText ? (
        <Text foreground={1} className={styles.searchResults} preset="heading4">
          {`Search results for "${searchText}" (${filteredItems.length})`}
        </Text>
      ) : null}
    </div>
  );

  const content = (
    <div className={styles.mainContent}>
      {selectedFilters.length > 0 ? (
        <TagGroup
          appearance="outline"
          aria-label="Selected filters"
          className={styles.selectedFilters}
          onDismiss={(_event, { value }) => {
            if (selectedFilters.length === 1) {
              searchInputRef.current?.focus();
            }
            handleFilterChange({ ...filters, [value]: [] });
          }}
          size="small"
        >
          {selectedFilters.map((filter) => (
            <Tag
              key={filter.key}
              aria-label={`Remove ${filter.label} filter: ${filter.displayNames.join(', ')}`}
              dismissible
              dismissIcon={{ role: 'presentation' }}
              title={`${filter.label}: ${filter.displayNames.join(', ')}`}
              value={filter.key}
            >
              {filter.label}: {filter.displayNames.slice(0, MAX_VISIBLE_FILTER_VALUES).join(', ')}
              {filter.displayNames.length > MAX_VISIBLE_FILTER_VALUES
                ? ` (+${filter.displayNames.length - MAX_VISIBLE_FILTER_VALUES})`
                : null}
            </Tag>
          ))}
          <InteractionTag>
            <InteractionTagPrimary onClick={handleClearAllFilters}>
              Clear filters
            </InteractionTagPrimary>
          </InteractionTag>
        </TagGroup>
      ) : null}
      <CatalogGrid
        catalogType={title.toLowerCase()}
        className={styles.catalogGrid}
        getItemHref={getItemHref}
        isLoading={isLoading ? filteredItems.length === 0 : false}
        items={filteredItems}
        renderItem={
          renderItem
            ? (item: ICatalogItem) => {
                const rendered = renderItem(item);
                return isValidElement(rendered) ? rendered : <div />;
              }
            : undefined
        }
      />
      {hasMore && onLoadMore && !isLoading ? (
        paginationMode === 'button' ? (
          <div className={styles.loadMoreContainer}>
            <Button
              appearance="secondary"
              data-testid="load-more-button"
              disabled={Boolean(isLoadingMore)}
              icon={isLoadingMore ? <Spinner aria-label="Loading more" size="tiny" /> : undefined}
              onClick={onLoadMore}
            >
              {isLoadingMore ? 'Loading more...' : 'Load more'}
            </Button>
          </div>
        ) : (
          <div
            ref={loadMoreSentinelRef}
            aria-busy={isLoadingMore}
            aria-live="polite"
            className={styles.loadMoreContainer}
            data-testid="infinite-scroll-sentinel"
          >
            <Button
              appearance="secondary"
              disabled={true}
              icon={isLoadingMore ? <Spinner aria-label="Loading more" size="tiny" /> : undefined}
            >
              Loading more...
            </Button>
          </div>
        )
      ) : null}
    </div>
  );

  return (
    <PageLayout
      className={className}
      scrollMode="page"
      header={
        <PageHeader
          title={title}
          count={totalCount ?? filteredItems.length}
          description={
            typeof description === 'string' ? (
              <Text preset="body" foreground={2} as="p">
                {description}
              </Text>
            ) : (
              description
            )
          }
          headerActions={headerActionButtons}
        />
      }
    >
      {hideFilter || (isLoading && filterGroups.length === 0) ? (
        <>
          {renderControls(null)}
          <PageBody>{content}</PageBody>
        </>
      ) : (
        <SidebarLayout
          header={renderControls}
          sidebarTitle="Filters"
          triggerAppearance="subtle"
          sidebarWidth={240}
          scrollable={false}
          sidebar={
            <FilterSidebar
              customFilterGroup={customFilterGroup}
              filterGroups={filterGroups}
              onCustomFilterChange={onCustomFilterChange}
              onFilterChange={handleFilterChange}
              selectedCustomFilter={selectedCustomFilter}
              selectedFilters={filters}
            />
          }
        >
          {content}
        </SidebarLayout>
      )}
    </PageLayout>
  );
}
