// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Theme } from './ThemeContext';

import { useThemeContext } from './useThemeContext';

export function useTheme(): Theme {
  const context = useThemeContext();
  return context.theme;
}
