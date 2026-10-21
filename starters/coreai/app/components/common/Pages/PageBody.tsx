// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import styles from './PageLayout.module.css';

/** Explicit body inset and scrolling. */
export interface PageBodyProps {
  children?: ReactNode;
  /** Defaults to default; use none when a child owns the inset. */
  padding?: 'default' | 'none';
  /** Defaults to false; enable when this body owns scrolling under a pane frame. */
  scrollable?: boolean;
  className?: string;
}

/** Supplies page content padding and optionally owns a scrollable region. */
export function PageBody({
  children,
  padding = 'default',
  scrollable = false,
  className,
}: PageBodyProps) {
  return (
    <div
      className={clsx(
        styles.body,
        padding === 'default' && styles.padded,
        scrollable && styles.scrollable,
        className,
      )}
    >
      {children}
    </div>
  );
}
