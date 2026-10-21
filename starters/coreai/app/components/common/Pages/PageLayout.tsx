// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import styles from './PageLayout.module.css';

/** Frame regions and scroll ownership; the host must provide a bounded height. */
export interface PageLayoutProps {
  /** Fixed above content unless scrollMode is page. */
  header?: ReactNode;
  /** Persistent actions below content unless scrollMode is page. */
  footer?: ReactNode;
  children: ReactNode;
  /** Defaults to content; panes delegates scrolling to descendants. */
  scrollMode?: 'page' | 'content' | 'panes';
  className?: string;
}

/** Composes an unpadded page frame with independently supplied header and footer. */
export function PageLayout({
  header,
  footer,
  children,
  scrollMode = 'content',
  className,
}: PageLayoutProps) {
  return (
    <div className={clsx(styles.frame, styles[`${scrollMode}Scroll`], className)}>
      {header}
      <div className={styles.content}>{children}</div>
      {footer == null ? null : <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}
