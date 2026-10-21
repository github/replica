// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ThemeContextValue } from './ThemeContext';

import { useContext } from 'react';

import { ThemeContext } from './ThemeContext';

export function useThemeContext(): ThemeContextValue {
  const themeContext = useContext(ThemeContext);
  if (!themeContext) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return themeContext;
}
