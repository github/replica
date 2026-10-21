// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useEffect, useRef, useState, type JSX, type PropsWithChildren } from 'react';
import { clsx } from 'clsx';
import { ContainerWidthContext } from './ContainerQueryContext';
import styles from './ContainerQueryProvider.module.css';

export interface ContainerQueryProviderProps {
  /** CSS class to apply to the container div (this IS your layout element) */
  className?: string;
}

/**
 * Renders a div that observes its own inline size via ResizeObserver and
 * provides the measured width to descendant useContainerQuery hooks via context.
 *
 * Use this as your main content wrapper — it replaces the div you'd otherwise
 * use for layout. This ensures width-based responsive logic responds to
 * available space rather than the viewport (which may include sidebars).
 */
export function ContainerQueryProvider({
  className,
  children,
}: PropsWithChildren<ContainerQueryProviderProps>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );

  const handleResize = useCallback((entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      const inlineSize = entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width;
      setWidth(inlineSize);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);

    // Set initial width
    setWidth(el.clientWidth);

    return () => observer.disconnect();
  }, [handleResize]);

  return (
    <ContainerWidthContext.Provider value={width}>
      <div ref={ref} className={clsx(styles.container, className)}>
        {children}
      </div>
    </ContainerWidthContext.Provider>
  );
}
