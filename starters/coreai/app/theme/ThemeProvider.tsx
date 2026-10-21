// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ThemeContextValue } from './ThemeContext';
import type { JSX, PropsWithChildren } from 'react';

import { CoreAIFluentProvider } from '@coreai-ds/react-components';
import { RendererProvider } from '@griffel/react';
import { useEffect, useState } from 'react';
import { createLayeredRenderer } from './createLayeredRenderer';

import { ThemeContext } from './ThemeContext';

interface ThemeProviderProps extends PropsWithChildren {
  themeContext: ThemeContextValue;
}

export function ThemeProvider({ children, themeContext }: ThemeProviderProps): JSX.Element {
  const [renderer] = useState(() => createLayeredRenderer());
  // HACK!! When theme is set to 'System', we need to force a re-render on the client side
  // to ensure that the correct theme is applied based on the user's preference.
  // This only applies to non-Chromium browsers, as they do not support the 'Sec-CH-Prefers-Color-Scheme' header.
  // The theme will flash light on the first render from the server, but it will be corrected on the second render.
  // (For Chromium browsers, the theme will be applied correctly on the first render.)
  // This seems to be a bug with how Fluent Provider and React Router framework mode work together.
  // The Fluent Provider will not rerender on the client side when changing the theme prop.
  // This only affects initial render; subsequent theme changes via OS settings will work as expected.
  const [clientSideInitialRender, setClientSideInitialRender] = useState(0);
  useEffect(() => {
    if (
      clientSideInitialRender === 0 &&
      themeContext.savedTheme === 'System' &&
      themeContext.theme === 'Dark'
    ) {
      setClientSideInitialRender(1);
    }
  }, [clientSideInitialRender, themeContext.savedTheme, themeContext.theme]);

  return (
    <ThemeContext.Provider key={clientSideInitialRender} value={themeContext}>
      <RendererProvider renderer={renderer}>
        <CoreAIFluentProvider theme={themeContext.themeStyles}>{children}</CoreAIFluentProvider>
      </RendererProvider>
    </ThemeContext.Provider>
  );
}
