// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ICatalogItem } from './Catalog.types';
import type { CheckboxOnChangeData, RadioGroupOnChangeData } from '@coreai-ds/react-components';
import type { ReactElement } from 'react';

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Badge,
  Checkbox,
  Radio,
  RadioGroup,
  Text,
} from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { Fragment, useCallback, useMemo } from 'react';

import styles from './FilterSidebar.module.css';

// Filter category definition
export interface IFilterCategory {
  id: string;
  title: string;
  options: IFilterOption[];
  getDisplayName?: (value: ICatalogItem) => string;
  /**
   * Whether this filter category should be initially expanded
   * If not provided, defaults to true (expanded)
   */
  defaultExpanded?: boolean;
}

// Filter option definition
export interface IFilterOption {
  id: string;
  label: string;
  count?: number;
}

// Filter state - a map of filter category IDs to selected option IDs
export type IFilterState = Record<string, string[]>;

// Props for the FilterSidebar component
export interface IFilterSidebarProps {
  /**
   * CSS class name for the sidebar container
   * Use this to apply custom styling to the filter sidebar
   */
  className?: string;

  /**
   * Filter categories to display in the sidebar
   * Each category contains a title, ID, and array of filter options
   * These will be displayed as collapsible accordion sections
   */
  filterGroups: IFilterCategory[];

  /**
   * Callback invoked when filters are changed
   * Receives the complete updated filter state
   * Parent component should update its state and perform filtering
   */
  onFilterChange: (filters: IFilterState) => void;

  /**
   * Currently selected filter values
   * Should be a map of category IDs to arrays of selected option IDs
   * This controls which checkboxes are checked in the UI
   */
  selectedFilters: IFilterState;

  /**
   * Custom filter category to display in radio button format to allow single selection
   * These will be displayed as collapsible accordion section on top of filterGroups
   */
  customFilterGroup?: IFilterCategory;

  /**
   * Currently selected custom filter value
   * This controls which radio button is checked in the UI
   */
  selectedCustomFilter?: string;

  /**
   * Callback invoked when custom filter selection is changed
   * Receives the new value of the selected custom filter
   * Parent component should update its state and perform filtering
   */
  onCustomFilterChange?: (selectedCustomFilter: string) => void;
}

/**
 * FilterSidebar component for displaying collapsible filter categories
 */
export function FilterSidebar({
  className,
  filterGroups,
  onFilterChange,
  selectedFilters,
  customFilterGroup,
  onCustomFilterChange,
  selectedCustomFilter,
}: IFilterSidebarProps): ReactElement {
  // Set initial open state for accordion items based on each group's defaultExpanded property
  const defaultOpenItems = useMemo(() => {
    const openItems: string[] = [];

    if (customFilterGroup && (customFilterGroup.defaultExpanded ?? true)) {
      openItems.push(customFilterGroup.id);
    }

    for (const group of filterGroups) {
      if (group.defaultExpanded ?? true) {
        openItems.push(group.id);
      }
    }

    return openItems;
  }, [customFilterGroup, filterGroups]);

  // Handle filter option change
  const handleFilterChange = useCallback(
    (groupId: string, optionId: string, selected: boolean) => {
      const newFilters = { ...selectedFilters };
      if (!Array.isArray(newFilters[groupId])) {
        newFilters[groupId] = [];
      }
      if (selected) {
        // Add the option if not already selected
        if (!newFilters[groupId].includes(optionId)) {
          newFilters[groupId] = [...newFilters[groupId], optionId];
        }
      } else {
        // Remove the option
        newFilters[groupId] = newFilters[groupId].filter((id) => id !== optionId);
      }

      onFilterChange(newFilters);
    },
    [selectedFilters, onFilterChange],
  );

  return (
    <div className={clsx(styles.filterSidebar, filterGroups.length > 0, className)}>
      <Text foreground={1} as="h2" className={styles.visuallyHidden} preset="heading2">
        Filters
      </Text>
      <Accordion collapsible={true} defaultOpenItems={defaultOpenItems} multiple={true}>
        {customFilterGroup && onCustomFilterChange ? (
          <Fragment key={customFilterGroup.id}>
            <AccordionItem className={styles.filterItem} value={customFilterGroup.id}>
              <AccordionHeader as="h3" button={{ className: styles.filterHeaderButton }}>
                <Text foreground={1} preset="bodyStrong">
                  {customFilterGroup.title}
                </Text>
              </AccordionHeader>
              <AccordionPanel className={styles.filterOptions}>
                <RadioGroup
                  onChange={(e: React.FormEvent<HTMLDivElement>, data: RadioGroupOnChangeData) => {
                    onCustomFilterChange(data.value);
                  }}
                  value={selectedCustomFilter}
                >
                  {customFilterGroup.options.map((option) => (
                    <div key={option.id} className={styles.filterOption}>
                      <Radio
                        label={
                          <>
                            {option.label}
                            {option.count !== undefined && option.count > 0 ? (
                              <Badge
                                appearance="tint"
                                className={styles.filterCount}
                                color="informative"
                                shape="rounded"
                                size="small"
                              >
                                {option.count}
                              </Badge>
                            ) : null}
                          </>
                        }
                        value={option.id}
                      />
                    </div>
                  ))}
                </RadioGroup>
              </AccordionPanel>
            </AccordionItem>
          </Fragment>
        ) : null}
        {filterGroups.map((group) => (
          <Fragment key={group.id}>
            <AccordionItem className={styles.filterItem} value={group.id}>
              <AccordionHeader as="h3" button={{ className: styles.filterHeaderButton }}>
                <Text foreground={1} preset="bodyStrong">
                  {Array.isArray(selectedFilters[group.id]) && selectedFilters[group.id].length > 0
                    ? `${group.title} (${selectedFilters[group.id].length.toString()})`
                    : group.title}
                </Text>
              </AccordionHeader>
              <AccordionPanel className={styles.filterOptions}>
                {group.options.map((option) => (
                  <div key={option.id} className={styles.filterOption}>
                    <Checkbox
                      checked={
                        Array.isArray(selectedFilters[group.id]) &&
                        selectedFilters[group.id].length > 0
                          ? selectedFilters[group.id].includes(option.id)
                          : false
                      }
                      label={
                        <>
                          {option.label}
                          {option.count !== undefined && option.count > 0 ? (
                            <Badge
                              appearance="tint"
                              className={styles.filterCount}
                              color="informative"
                              shape="rounded"
                              size="small"
                            >
                              {option.count}
                            </Badge>
                          ) : null}
                        </>
                      }
                      onChange={(
                        e: React.FormEvent<HTMLInputElement>,
                        data: CheckboxOnChangeData,
                      ) => {
                        handleFilterChange(group.id, option.id, Boolean(data.checked));
                      }}
                    />
                  </div>
                ))}
              </AccordionPanel>
            </AccordionItem>
          </Fragment>
        ))}
      </Accordion>
    </div>
  );
}
