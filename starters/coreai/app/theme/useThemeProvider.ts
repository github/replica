// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ThemeContextValue, Theme } from './ThemeContext';
import type { DataVizTokens } from './themes';

import { useMediaQuery } from '~/components/common';
import { darkTheme, lightTheme } from './themes';
import { useCallback, useEffect, useMemo } from 'react';
import { useLoaderData } from 'react-router';
import useLocalStorage from 'use-local-storage';

export type ThemeProviderData =
  | {
      theme?: Theme;
      prefersDarkTheme: boolean;
    }
  | undefined;

export function useThemeProvider(): ThemeContextValue {
  const { theme: initialTheme, prefersDarkTheme: prefersDarkThemeFromLoader = true } =
    useLoaderData<ThemeProviderData>() ?? {};

  const prefersDarkThemeFromMediaQuery = useMediaQuery('(prefers-color-scheme: dark)');

  const defaultTheme: Theme =
    initialTheme && ['Light', 'Dark', 'System'].includes(initialTheme) ? initialTheme : 'System';

  const [savedTheme, setSavedTheme] = useLocalStorage<Theme>('theme', defaultTheme);

  const prefersDark = import.meta.env.SSR
    ? prefersDarkThemeFromLoader
    : prefersDarkThemeFromMediaQuery;

  const isDarkMode = savedTheme === 'System' ? prefersDark : savedTheme === 'Dark';

  const currentTheme = savedTheme === 'System' ? (prefersDark ? 'Dark' : 'Light') : savedTheme;

  const themeStyles = isDarkMode ? darkTheme : lightTheme;

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setSavedTheme(newTheme);
    },
    [setSavedTheme],
  );

  useEffect(() => {
    document.documentElement.style.setProperty('color-scheme', isDarkMode ? 'dark' : 'light');

    document.documentElement.dataset.theme = isDarkMode ? 'Dark' : 'Light';
  }, [isDarkMode]);

  // In the future, this may need to be updated to change based on light/dark theme
  // see dataVizRawColors in themes.ts
  const dataVizTokens: DataVizTokens = useMemo(
    () => ({
      dataViz1: themeStyles.dataViz1,
      dataViz2: themeStyles.dataViz2,
      dataViz3: themeStyles.dataViz3,
      dataViz4: themeStyles.dataViz4,
      dataViz5: themeStyles.dataViz5,
      dataViz6: themeStyles.dataViz6,
      dataViz7: themeStyles.dataViz7,
      dataVizAccent: themeStyles.dataVizAccent,
      dataVizGradientStartOpacity: themeStyles.dataVizGradientStartOpacity,
      dataVizGradientEndOpacity: themeStyles.dataVizGradientEndOpacity,
    }),
    [themeStyles],
  );

  const getDataVizColor = useCallback(
    (index: number): string => {
      const dataVizColors = [
        themeStyles.dataViz1,
        themeStyles.dataViz2,
        themeStyles.dataViz3,
        themeStyles.dataViz4,
        themeStyles.dataViz5,
        themeStyles.dataViz6,
        themeStyles.dataViz7,
      ];
      return dataVizColors[index % dataVizColors.length];
    },
    [themeStyles],
  );

  return useMemo(
    () => ({
      isDarkMode,
      savedTheme,
      setTheme,
      theme: currentTheme,
      themeStyles,
      dataVizTokens,
      getDataVizColor,
    }),
    [isDarkMode, savedTheme, setTheme, currentTheme, themeStyles, dataVizTokens, getDataVizColor],
  );
}
