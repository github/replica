// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode } from 'react';

// Simplified catalog item for coreai-sandbox
export interface ICatalogItem {
  id: string;
  disabled?: boolean;
  name: string;
  version?: string;
  description?: string;
  icon?: ReactNode;
  provider?: string;
  category?: string;
  filterProperties?: Record<string, string | string[]>;
  updatedTime?: string;
  releaseDate?: string;
}

/**
 * Sort option for the catalog
 */
export interface ISortOption {
  key: string;
  text: string;
  onSort?: (items: ICatalogItem[]) => ICatalogItem[];
}
