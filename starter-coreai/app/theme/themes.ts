// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Theme } from '@coreai-ds/react-components';

import {
  coreaiBrandVariants as brandVariants,
  coreaiDarkTheme,
  coreaiLightTheme,
} from '@coreai-ds/react-components';

export { brandVariants };

export type DataVizTokens = {
  dataViz1: string;
  dataViz2: string;
  dataViz3: string;
  dataViz4: string;
  dataViz5: string;
  dataViz6: string;
  dataViz7: string;
  dataVizAccent: string;
  dataVizGradientStartOpacity: number;
  dataVizGradientEndOpacity: number;
};

export type SpacingTokens = {
  spacingNone: string;
  spacingXXS: string;
  spacingXS: string;
  spacingSNudge: string;
  spacingS: string;
  spacingMNudge: string;
  spacingM: string;
  spacingL: string;
  spacingXL: string;
  spacingXXL: string;
  spacingXXXL: string;
  spacingXXXXL: string;
};

export type ContentWidthTokens = {
  contentWidthXS: string;
  contentWidthS: string;
  contentWidthM: string;
  contentWidthL: string;
  contentWidthXL: string;
};

export const spacingTokens: SpacingTokens = {
  spacingNone: '0',
  spacingXXS: '2px',
  spacingXS: '4px',
  spacingSNudge: '6px',
  spacingS: '8px',
  spacingMNudge: '10px',
  spacingM: '12px',
  spacingL: '16px',
  spacingXL: '20px',
  spacingXXL: '24px',
  spacingXXXL: '32px',
  spacingXXXXL: '40px',
};

export const contentWidthTokens: ContentWidthTokens = {
  contentWidthXS: '240px',
  contentWidthS: '480px',
  contentWidthM: '720px',
  contentWidthL: '960px',
  contentWidthXL: '1284px',
};

/**
 * Data visualization palette
 * MUST BE HEX VALUES
 * NOTE: If this needs to be expanded for light/dark themes,
 * ...ie if we need foreground/text colors
 * ...it will need to be added to both theme objects below,
 * ...and modified in the context provider
 */
export const dataVizTokensRaw: DataVizTokens = {
  // This order is intentional. Use the colors at starting at 1 and going down.
  dataViz1: '#637CEF', // cornflower.tint10
  dataViz2: '#F393EB', // orchid.tint10
  dataViz3: '#4EC8AF', // teal.tint20
  dataViz4: '#3BBAFF', // lightBlue.primary
  dataViz5: '#2AA0A4', // teal.tint20
  dataViz6: '#F69672', // ???
  dataViz7: '#9373C0', // ???
  dataVizAccent: brandVariants[80],
  dataVizGradientStartOpacity: 0.3,
  dataVizGradientEndOpacity: 0,
};

export type NextGenTheme = Theme & ContentWidthTokens & DataVizTokens & SpacingTokens;

// Brand ramp, dark-mode contrast tuning, and Aptos font all now come from CoreAI's theme.
export const lightTheme: NextGenTheme = {
  ...coreaiLightTheme,
  ...spacingTokens,
  ...contentWidthTokens,
  ...dataVizTokensRaw,
};

export const darkTheme: NextGenTheme = {
  ...coreaiDarkTheme,
  ...spacingTokens,
  ...contentWidthTokens,
  ...dataVizTokensRaw,
};
