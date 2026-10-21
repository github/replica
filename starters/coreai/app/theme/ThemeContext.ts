// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { DataVizTokens, NextGenTheme } from './themes';

import { createContext } from 'react';

export type Theme = 'Light' | 'Dark' | 'System';

export interface ThemeContextValue {
  isDarkMode: boolean;
  savedTheme: Theme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
  themeStyles: NextGenTheme;
  dataVizTokens: DataVizTokens;
  /** Utility to pass any positive integer and get a dataViz color back */
  getDataVizColor: (index: number) => string;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
