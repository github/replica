// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useReducer, useRef } from 'react';

interface ICatalogPaginationState {
  currentPage: number;
  setPageNumber: (pageNumber: number) => void;
  setPageToken: (pageNumber: number, token: string | undefined) => void;
  resetPagination: () => void;
  getCurrentPageToken: () => string | undefined;
  canGoNext: (continuationToken?: string | null) => boolean;
  canGoPrev: () => boolean;
}

/**
 * Hook for managing catalog pagination state
 */
export function useCatalogPagination(): ICatalogPaginationState {
  // Use a ref to store pagination state to avoid triggering re-renders
  const stateRef = useRef({
    currentPage: 1,
    pageTokens: new Map<number, string | undefined>([[1, undefined]]),
  });

  // Force update function to trigger re-render when needed
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const setPageNumber = useCallback((pageNumber: number) => {
    stateRef.current.currentPage = pageNumber;
    forceUpdate();
  }, []);

  const setPageToken = useCallback((pageNumber: number, token: string | undefined) => {
    stateRef.current.pageTokens.set(pageNumber, token);
  }, []);

  const resetPagination = useCallback(() => {
    stateRef.current.currentPage = 1;
    stateRef.current.pageTokens = new Map([[1, undefined]]);
    forceUpdate();
  }, []);

  const getCurrentPageToken = useCallback(
    () => stateRef.current.pageTokens.get(stateRef.current.currentPage),
    [],
  );

  const canGoNext = useCallback(
    (token?: string | null) => token !== null && token !== undefined && token !== '',
    [],
  );

  const canGoPrev = useCallback(() => stateRef.current.currentPage > 1, []);

  return {
    currentPage: stateRef.current.currentPage,
    setPageNumber,
    setPageToken,
    resetPagination,
    getCurrentPageToken,
    canGoNext,
    canGoPrev,
  };
}
