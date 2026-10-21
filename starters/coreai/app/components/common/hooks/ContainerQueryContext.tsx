// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createContext, useContext } from 'react';

/**
 * Context providing the container's inline size (width).
 * Used by useContainerQuery to evaluate width breakpoints against
 * the actual available space rather than the viewport.
 */
export const ContainerWidthContext = createContext<number>(
  typeof window !== 'undefined' ? window.innerWidth : 1024,
);

export function useContainerWidth(): number {
  return useContext(ContainerWidthContext);
}
