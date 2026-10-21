// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ICatalogItem } from '../Catalog.types';
import type { IFilterCategory } from '../FilterSidebar';

import { useMemo } from 'react';

/**
 * Utility function that generates filter groups from catalog items' filter properties
 * @param items The catalog items to generate filters from
 * @returns The generated filter groups
 */
export function generateFilterGroups(items: ICatalogItem[]): IFilterCategory[] {
  // If no items, return empty array
  if (items.length === 0) {
    return [];
  }

  const filterData = new Map<string, Map<string, number>>();

  for (const item of items) {
    if (item.filterProperties) {
      for (const [propertyKey, propertyValue] of Object.entries(item.filterProperties)) {
        // Get or create the value count map for this property
        let valueCountMap = filterData.get(propertyKey);
        if (!valueCountMap) {
          valueCountMap = new Map<string, number>();
          filterData.set(propertyKey, valueCountMap);
        }

        // Handle array values
        if (Array.isArray(propertyValue)) {
          for (const value of propertyValue) {
            valueCountMap.set(value, (valueCountMap.get(value) ?? 0) + 1);
          }
        }
        // Handle string values
        else if (typeof propertyValue === 'string') {
          valueCountMap.set(propertyValue, (valueCountMap.get(propertyValue) ?? 0) + 1);
        }
      }
    }
  }

  // Convert the collected data to filter groups
  const generatedFilterGroups: IFilterCategory[] = [];
  for (const [propertyKey, valueCountMap] of filterData.entries()) {
    if (valueCountMap.size > 0) {
      generatedFilterGroups.push({
        id: propertyKey,
        title: ((propertyKey.at(0)?.toUpperCase() ?? '') + propertyKey.slice(1))
          .replaceAll(/([A-Z])/g, ' $1')
          .trim(),
        options: [...valueCountMap.entries()].map(([value, count]) => ({
          id: value,
          label: value,
          count,
        })),
      });
    }
  }

  return generatedFilterGroups;
}

/**
 * Hook that generates filter groups from items' filter properties
 * @param items The catalog items to generate filters from
 * @param providedFilterGroups Optional pre-defined filter groups
 * @returns The filter groups to use in the sidebar
 */
export function useFilterGroups(
  items: ICatalogItem[],
  providedFilterGroups?: IFilterCategory[],
): IFilterCategory[] {
  return useMemo(() => {
    // If filter groups are provided, use them
    if (providedFilterGroups && providedFilterGroups.length > 0) {
      return providedFilterGroups;
    }

    // Use the utility function to generate filter groups
    return generateFilterGroups(items);
  }, [providedFilterGroups, items]);
}
