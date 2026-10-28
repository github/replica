// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ImageProps as CoreAIImageProps } from '@coreai-ds/react-components';
import type { JSX } from 'react';

import { Image as CoreAIImage } from '@coreai-ds/react-components';
import { useThemeContext } from '~/theme/useThemeContext';

type ThemeImageSource = {
  darkMode: string;
  lightMode: string;
};

export type ImageProps = Omit<CoreAIImageProps, 'src'> & {
  src?: CoreAIImageProps['src'] | ThemeImageSource;
};

export function resolveImageSrc(path: string): string {
  try {
    void new URL(path);
    return path;
  } catch {
    // Relative asset paths need the deployment base URL.
  }

  const baseUrl = import.meta.env.BASE_URL;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const pathWithoutBase = path.startsWith(normalizedBase)
    ? path.slice(normalizedBase.length)
    : path;
  const relativePath = pathWithoutBase.startsWith('/') ? pathWithoutBase.slice(1) : pathWithoutBase;

  return `${normalizedBase}${relativePath}`;
}

export function Image({ src, ...props }: ImageProps): JSX.Element {
  const { isDarkMode } = useThemeContext();
  const selectedSrc =
    typeof src === 'string' || src === undefined ? src : isDarkMode ? src.darkMode : src.lightMode;

  return (
    <CoreAIImage
      {...props}
      src={selectedSrc === undefined ? undefined : resolveImageSrc(selectedSrc)}
    />
  );
}
