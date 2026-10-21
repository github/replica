// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useContainerWidth } from './ContainerQueryContext';

/**
 * Parse a media-query-style string into a comparison.
 * Supports: (max-width: Npx), (min-width: Npx), (width <= N), (width >= N), (width < N), (width > N)
 */
function parseWidthQuery(query: string): ((width: number) => boolean) | null {
  // Modern syntax: (width <= 768px), (width < 768px), (width >= 768px), (width > 768px)
  const modernMatch = query.match(/\(\s*width\s*([<>]=?)\s*(\d+)(?:px)?\s*\)/);
  if (modernMatch) {
    const [, op, value] = modernMatch;
    const px = Number(value);
    switch (op) {
      case '<=':
        return (w) => w <= px;
      case '<':
        return (w) => w < px;
      case '>=':
        return (w) => w >= px;
      case '>':
        return (w) => w > px;
    }
  }

  // Legacy syntax: (max-width: 768px), (min-width: 768px)
  const legacyMatch = query.match(/\(\s*(max|min)-width:\s*(\d+)px\s*\)/);
  if (legacyMatch) {
    const [, type, value] = legacyMatch;
    const px = Number(value);
    return type === 'max' ? (w) => w <= px : (w) => w >= px;
  }

  return null;
}

/**
 * Container-aware replacement for useMediaQuery for width-based queries.
 *
 * Evaluates width breakpoints against the actual container size (provided by
 * ContainerWidthContext) rather than the viewport. This ensures responsive
 * behavior is correct when sidebars (like Vellum) consume viewport space.
 *
 * For non-width queries (e.g., prefers-color-scheme, height), use useMediaQuery instead.
 *
 * @param query - A CSS media query string with a width condition
 * @returns Whether the container width matches the query
 */
export function useContainerQuery(query: string): boolean {
  const containerWidth = useContainerWidth();
  const evaluate = parseWidthQuery(query);

  if (!evaluate) {
    // Fallback: if we can't parse the query, warn in dev
    if (import.meta.env.DEV) {
      console.warn(
        `[useContainerQuery] Could not parse width query: "${query}". ` +
          `Use useMediaQuery for non-width queries (height, color-scheme, etc.)`,
      );
    }
    return false;
  }

  return evaluate(containerWidth);
}
