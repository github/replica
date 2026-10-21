// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { wrapIcon } from '@fluentui/react-icons';
import type { FluentIconsProps } from '@fluentui/react-icons';

export const CoreAILogo = wrapIcon((props: FluentIconsProps) => {
  return (
    <svg
      height="24px"
      width="24px"
      role="presentation"
      focusable="false"
      viewBox="-0.74 -0.59 44 44"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M27.43 2.896H39.77V15.236H27.43V2.896Z" />
      <path d="M2.749 2.896H15.089V15.236H2.749V2.896Z" />
      <path d="M15.09 15.236H27.431V27.576H15.09V15.236Z" />
      <path d="M2.749 27.576H15.089V39.916H2.749V27.576Z" />
      <path d="M27.43 27.576H39.77V39.916H27.43V27.576Z" />
    </svg>
  );
}, 'CoreAILogo');
